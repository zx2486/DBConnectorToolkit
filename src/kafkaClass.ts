import bunyan from 'bunyan'
import type {
    QueueConfig, QueueMessage, QueueClass,
    Query
} from './baseClass'


export default class KafkaClass implements QueueClass {
    private config: QueueConfig
    private producerConfig: any
    private consumerConfig: any
    private produceCount: number = 0
    private consumeCount: number = 0
    private producer: any
    private consumer: any
    private consumerList: Map<string, (_msg: QueueMessage) => Promise<void>> = new Map()
    private producerConnected: boolean = false
    private consumerConnected: boolean = false
    private logger: bunyan

    constructor(_config: QueueConfig) {
        this.config = _config
        if (!_config.client !== 'kafka' || !_config.brokerList) {
            throw new Error('Invalid Kafka config')
        }
        this.logger = bunyan.createLogger({
            name: 'KafkaClass',
            streams: [{ stream: process.stderr, level: _config.logLevel as bunyan.LogLevel }],
        })
        this.producerConfig = {
            'metadata.broker.list': _config.brokerList,
            'compression.codec': _config.codec || 'gzip',
            'queue.buffering.max.ms': _config.bufferMaxMs || 10,
            'queue.buffering.max.messages': _config.bufferMaxMessages || 100000,
            'socket.keepalive.enable': _config.keepAlive || false,
            'enable.auto.commit': _config.autoCommit || false,
        }
        if (_config.securityProtocol && _config.saslMechanism || _config.saslUsername || _config.saslPassword) {
            this.producerConfig['security.protocol'] = _config.securityProtocol
            this.producerConfig['sasl.mechanism'] = _config.saslMechanism
            this.producerConfig['sasl.username'] = _config.saslUsername
            this.producerConfig['sasl.password'] = _config.saslPassword
        }
        this.consumerConfig = {
            ...this.producerConfig,
            'group.id': 'kafka',
        }
        this.producerConfig['request.required.acks'] = _config.requiredAcks || 0
        this.producerConfig['poolInterval'] = _config.pollInterval || 100
        this.consumerConfig['consumeTimeout'] = _config.consumeTimeout || 100
        this.consumerConfig['consumeLoopDelay'] = _config.consumeLoopDelay || 10
    }

    async connect(isProducer: boolean = true): Promise<void> {
        // Connect to Kafka
        if (isProducer) {
            try {
                this.producer = new Kafka.Producer(
                    this.producerConfig, { 'request.required.acks': this.producerConfig['request.required.acks'] }
                )
                this.producer.setPollInterval(this.producerConfig['poolInterval'])
                this.producer.on('ready', () => {
                    this.producerConnected = true
                    this.logger.info({ event: 'Producer - ready' })
                })
                this.producer.on('event.error', (err: any) => {
                    this.logger.error({ event: 'Producer - event.error', err })
                })
                this.producer.on('delivery-report', async (err: any, report: any) => {
                    if (err) {
                        this.logger.error({ event: 'Producer - delivery report error', err })
                    }
                    if (report) {
                        this.produceCount += 1
                        this.logger.debug({
                            event: 'Producer - delivery report received',
                            data: {
                                key: report.key,
                                opaque: report.opaque
                            }
                        })
                    }
                })
                this.producer.on('disconnected', () => {
                    this.producerConnected = false
                    this.logger.info({ event: 'Producer - disconnected' })
                })
                this.producer.on('connection.failure', (err: any) => {
                    this.logger.error({ event: 'Producer - connection.failure', err })
                })
                await this.producer.connect()
            } catch (err) {
                this.logger.error({ event: 'Producer - connect', err })
            }
        } else {
            try {
                this.consumer = new Kafka.KafkaConsumer(this.consumerConfig, {})
                this.consumer.setDefaultConsumeTimeout(this.consumerConfig['consumeTimeout'])
                this.consumer.setDefaultConsumeLoopTimeoutDelay(this.consumerConfig['consumeLoopDelay'])
                this.consumer.on('ready', () => {
                    this.consumerConnected = true
                    this.logger.info({ event: 'Consumer - ready' })
                })
                this.consumer.on('event.error', (err: any) => {
                    this.logger.error({ event: 'Consumer - event.error', err })
                })
                this.consumer.on('data', async (data: any) => {
                    const t0 = performance.now()
                    const consumerHandler = this.consumerList.get(data.topic)
                    if (consumerHandler) {
                        this.consumeCount += 1
                        await consumerHandler({
                            topic: data.topic,
                            message: data.value,
                            key: data.key,
                            headers: data.headers,
                            ingressionTs: data.timestamp
                        })
                    } else {
                        this.logger.warn({
                            event: 'Consumer - data - unknown data.topic',
                            data: { topic: data.topic }
                        })
                    }
                    const t1 = performance.now()
                    this.logger.debug({
                        event: 'Consumer - data',
                        data: { topic: data.topic, totalTime: `${(t1 - t0).toFixed(3)} ms` }
                    })
                })
                this.consumer.on('disconnected', () => {
                    this.consumerConnected = false
                    this.logger.info({ event: 'Consumer - disconnected' })
                })
                this.consumer.on('connection.failure', (err: any) => {
                    this.logger.error({ event: 'Consumer - connection.failure', err })
                })
                await this.consumer.connect()
            } catch (err) {
                this.logger.error({ event: 'Consumer - connect', err })
            }
        }

    }

    async disconnect(isProducer: boolean = true): Promise<void> {
        if (isProducer && this.producer) await this.producer.disconnect()
        else if (!isProducer && this.consumer) await this.consumer.disconnect()
    }

    isconnect(isProducer: boolean = true): boolean {
        // Check if connected to Kafka
        return (isProducer) ? this.producerConnected : this.consumerConnected
    }

    getConfig(isProducer: boolean = true): any {
        return (isProducer) ? this.producerConfig : this.consumerConfig
    }

    sendCount(): number {
        return this.produceCount
    }

    receiveCount(): number {
        return this.consumeCount
    }

    convertRequestHeadersToKafkaHeaders(headers = {}) {
        return Object.entries(headers).map((v) => ({ [v[0]]: v[1].toString() }))
    }

    async send(_message: QueueMessage[]): Promise<void> {
        // Send message to Kafka
        _message.forEach((msg) => {
            try {
                const { topic, message, key, headers, ingressionTs } = msg
                const parsedHeaders = this.convertRequestHeadersToKafkaHeaders(headers)
                const buffer = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message))
                this.producer.produce(
                    topic,
                    null,
                    buffer,
                    key,
                    ingressionTs || Date.now(),
                    undefined,
                    parsedHeaders
                )
            } catch (err) {
                this.logger.error({
                    event: 'Producer - produce err',
                    err,
                    data: {
                        ...msg
                    }
                })
            }
        })
    }

    async subscribe(_topicList: { topic: string, callback: (_msg: QueueMessage) => Promise<void> }[]): Promise<void> {
        // extract the callback function from the topicList and store it in the consumerList
        _topicList.forEach((topic) => {
            this.consumerList.set(topic.topic, topic.callback)
        })
        // subscribe to the topics
        await this.consumer.subscribe(_topicList.map((topic) => topic.topic))
        await this.consumer.consume()
    }

    async createTopic(_topicList: { topic: string, partitionNum: number, replicaNum: number, retentionMs: number }[]): Promise<void> {
        // Create a topic in Kafka
        try {
            const admin = new Kafka.AdminClient.create({ ...this.producerConfig, 'client.id': 'kafka-admin', })
            await Promise.all(_topicList.map(async ({ topic, partitionNum, replicaNum, retentionMs }) => {
                await admin.createTopic({
                    topic,
                    num_partitions: partitionNum || 1,
                    replication_factor: replicaNum || 1,
                    config: { 'retention.ms': retentionMs || 86400000 } // 1 day
                }, (err: any) => {
                    if (err && !err.message.includes('already exists')) {
                        this.logger.error({ event: 'KafkaAdmin - createTopic', data: { topic }, err })
                    } else if (err && err.message.includes('already exists')) {
                        this.logger.info({
                            event: 'KafkaAdmin - createTopic',
                            data: { msg: `Topic (${topic}) already exists, don't need to create and ignore error` }
                        })
                    } else {
                        this.logger.debug({
                            event: 'KafkaAdmin - createTopic',
                            data: { msg: `Topic (${topic}) created` }
                        })
                    }
                })
            }))
        } catch (err) {
            this.logger.error({ event: 'KafkaAdmin - createTopic', err })
        }
    }
}
import { UUID } from 'crypto'
import bunyan from 'bunyan'
import {
  Kafka, logLevel, CompressionTypes, EachMessagePayload,
} from 'kafkajs'
import type {
  QueueConfig, QueueMessage, QueueClass,
} from './baseClass'

export default class KafkaClass implements QueueClass {
  private config: any
  private kafkaObj: any
  private produceCount: number = 0
  private consumeCount: number = 0
  private producer: any
  private consumer: any
  private consumerList: Map<string, (_msg: QueueMessage) => Promise<void>> = new Map()
  private producerConnected: boolean = false
  private consumerConnected: boolean = false
  private logger: bunyan

  constructor(_config: QueueConfig) {
    // this.config = _config
    if (_config.client !== 'kafka' || _config.brokerList.length <= 0 || !_config.appName) {
      throw new Error('Invalid Kafka config')
    }
    const {
      // eslint-disable-next-line no-unused-vars
      client, appName, brokerList, logLevel: clientlogLevel, msgTimeout, compression, ...restConfig
    } = _config
    this.logger = bunyan.createLogger({
      name: 'KafkaClass',
      streams: [{ stream: process.stderr, level: _config.logLevel as bunyan.LogLevel }],
    })
    let kafkaLogLevel: logLevel
    switch (clientlogLevel) {
      case 'trace':
      case 'debug':
        kafkaLogLevel = logLevel.DEBUG
        break
      case 'info':
        kafkaLogLevel = logLevel.INFO
        break
      case 'warn':
        kafkaLogLevel = logLevel.WARN
        break
      case 'error':
      case 'fatal':
        kafkaLogLevel = logLevel.ERROR
        break
      default:
        kafkaLogLevel = logLevel.NOTHING
    }
    let msgCompression: CompressionTypes
    switch (compression) {
      case 'gzip':
        msgCompression = CompressionTypes.GZIP
        break
      case 'snappy':
        msgCompression = CompressionTypes.Snappy
        break
      case 'lz4':
        msgCompression = CompressionTypes.LZ4
        break
      case 'zstd':
        msgCompression = CompressionTypes.ZSTD
        break
      default:
        msgCompression = CompressionTypes.None
    }
    this.config = {
      ...restConfig,
      clientId: appName,
      brokers: brokerList,
      logLevel: kafkaLogLevel,
      timeout: msgTimeout || 30000,
      compression: msgCompression,
    }
    this.kafkaObj = new Kafka({ ...this.config })
  }

  async connect(_isProducer: boolean = true): Promise<void> {
    // Connect to Kafka
    if (_isProducer) {
      try {
        this.producer = this.kafkaObj.producer()
        await this.producer.connect()
        this.producerConnected = true
      } catch (err) {
        this.logger.error({ event: 'Producer - connect', err })
      }
    } else {
      try {
        if (!this.config.groupId) {
          throw new Error('Invalid Kafka config: groupId is required for consumer')
        }
        this.consumer = this.kafkaObj.consumer({ groupId: this.config.groupId })
        await this.consumer.connect()
        this.consumerConnected = true
      } catch (err) {
        this.logger.error({ event: 'Consumer - connect', err })
      }
    }
  }

  async disconnect(_isProducer: boolean = true): Promise<void> {
    if (_isProducer && this.producer) {
      await this.producer.disconnect()
      this.producerConnected = false
    } else if (!_isProducer && this.consumer) {
      await this.consumer.disconnect()
      this.consumerConnected = false
    }
  }

  isconnect(_isProducer: boolean = true): boolean {
    // Check if connected to Kafka
    return (_isProducer) ? this.producerConnected : this.consumerConnected
  }

  getConfig(): any {
    return this.config
  }

  sendCount(): number {
    return this.produceCount
  }

  receiveCount(): number {
    return this.consumeCount
  }

  async send(_message: QueueMessage[]): Promise<UUID | null> {
    if (!this.producerConnected || !this.producer) {
      throw new Error('Producer is not connected')
    }
    if (_message.length === 0) {
      return null
    }
    // Send message to Kafka
    // group the messages in _message by topic
    const msgMap = new Map()
    _message.forEach((msg) => {
      if (msgMap.has(msg.topic)) {
        msgMap.get(msg.topic).push(msg)
      } else {
        msgMap.set(msg.topic, [msg])
      }
    })
    // send the messages to Kafka
    try {
      this.producer.sendBatch({
        topicMessages: Array.from(msgMap.entries()).map(([topic, msgs]) => ({
          topic,
          messages: msgs.map((msg: QueueMessage) => {
            const message: any = {
              value: msg.message,
              key: msg.key,
              timestamp: msg.ingressionTs || Date.now(),
            }
            if (msg.headers) {
              message.headers = msg.headers
            }
            return message
          }),
          acks: this.config.acks || -1,
          timeout: this.config.timeout,
          compression: this.config.compression,
        })),
      })
      this.produceCount += _message.length
    } catch (err) {
      this.logger.error({
        event: 'Producer - produce err',
        err,
        data: {
          ..._message,
        },
      })
    }
    return null
  }

  async subscribe(
    _topicList: {
      topic: string,
      callback: (_msg: QueueMessage) => Promise<void>
    }[],
    fromBeginning: boolean = false,
  ): Promise<void> {
    if (!this.consumerConnected || !this.consumer) {
      throw new Error('Consumer is not connected')
    }
    if (_topicList.length === 0) {
      return
    }
    // extract the callback function from the topicList and store it in the consumerList
    _topicList.forEach((topic) => {
      this.consumerList.set(topic.topic, topic.callback)
    })
    // subscribe to the topics
    try {
      await this.consumer.subscribe({
        topics: _topicList.map((topic) => topic.topic),
        fromBeginning,
      })
      await this.consumer.run({
        eachMessage: async (messagePayload: EachMessagePayload) => {
          const { topic, partition, message } = messagePayload
          const prefix = `${topic}[${partition} | ${message.offset}] / ${message.timestamp}`
          this.logger.debug({
            event: 'Consumer - message',
            data: {
              msg: `- ${prefix} ${message.key}`,
            },
          })
          const callback = this.consumerList.get(topic)
          if (callback) {
            try {
              await callback({
                topic,
                message: message.value?.toString() || '',
                key: message.key?.toString() || '',
                headers: message.headers,
                ingressionTs: Number(message.timestamp),
              })
              this.consumeCount += 1
            } catch (err) {
              this.logger.error({
                event: 'Consumer - callback err',
                err,
                data: {
                  msg: `- ${prefix} ${message.key}`,
                },
              })
            }
          } else {
            this.logger.error({
              event: 'Consumer - callback not found',
              data: {
                msg: `- ${prefix} ${message.key}`,
              },
            })
          }
        },
      })
    } catch (err) {
      this.logger.error({
        event: 'Consumer - subscribe err',
        err,
        data: {
          ..._topicList,
        },
      })
    }
  }
}

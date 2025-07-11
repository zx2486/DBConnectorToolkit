import assert from 'assert'
import {
  describe, it, before, after,
} from 'mocha'
import {
  logLevel, CompressionTypes, EachMessagePayload,
} from 'kafkajs'
import sinon from 'ts-sinon'
import KafkaClass from '../src/kafkaClass'

const standaloneConfig = {
  client: 'kafka',
  appName: 'test-app',
  brokerList: ['localhost:9092'],
}

describe('KafkaClass', () => {
  describe('Class constructor throw error correctly', () => {
    it('throw error correctly', async () => {
      const invalidConfigs = [
        { ...standaloneConfig, client: 'notkafka' },
        { ...standaloneConfig, brokerList: [] },
        { ...standaloneConfig, appName: '' },
      ]
      await Promise.all(invalidConfigs.map(async (c) => {
        await assert.rejects(
          async () => {
            const kafkaClassShouldNotWork = new KafkaClass(c)
            assert.fail(new Error(`should throw error but did not ${c}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, 'Invalid Kafka config')
            return true
          },
        )
      }))
    })
  })

  describe('Class constructor works correctly', () => {
    it('works correctly', async () => {
      const kafkaClass = new KafkaClass(standaloneConfig)
      assert.strictEqual(kafkaClass.getConfig().clientId, standaloneConfig.appName)
      assert.strictEqual(kafkaClass.getConfig().brokers, standaloneConfig.brokerList)
    })
    it('works correctly with optional configs', async () => {
      const kafkaClass = new KafkaClass({
        ...standaloneConfig,
        acks: 1,
        logLevel: 'debug',
        compression: 'gzip',
        msgTimeout: 1000,
      })
      assert.strictEqual(kafkaClass.getConfig().clientId, standaloneConfig.appName)
      assert.strictEqual(kafkaClass.getConfig().brokers, standaloneConfig.brokerList)
      assert.strictEqual(kafkaClass.getConfig().acks, 1)
      assert.strictEqual(kafkaClass.getConfig().logLevel, logLevel.DEBUG)
      assert.strictEqual(kafkaClass.getConfig().compression, CompressionTypes.GZIP)
      const testConfigs = [
        {
          logLevel: 'info',
          expectedLogLevel: logLevel.INFO,
          compression: 'snappy',
          expectedCompression: CompressionTypes.Snappy,
        },
        {
          logLevel: 'warn',
          expectedLogLevel: logLevel.WARN,
          compression: 'lz4',
          expectedCompression: CompressionTypes.LZ4,
        },
        {
          logLevel: 'fatal',
          expectedLogLevel: logLevel.ERROR,
          compression: 'zstd',
          expectedCompression: CompressionTypes.ZSTD,
        },
      ]
      testConfigs.forEach((c) => {
        const kafkaClassTest = new KafkaClass({
          ...standaloneConfig,
          logLevel: c.logLevel,
          compression: c.compression,
        })
        assert.strictEqual(kafkaClassTest.getConfig().logLevel, c.expectedLogLevel)
        assert.strictEqual(kafkaClassTest.getConfig().compression, c.expectedCompression)
      })
    })
  })
})

describe('KafkaClass functions', () => {
  let kafkaClass: KafkaClass
  let kafkaClass2: KafkaClass
  let kafkaObjStub: sinon.SinonStubbedInstance<any>
  let loggerStub: sinon.SinonStubbedInstance<any>
  let producerStub: sinon.SinonStubbedInstance<any>
  let consumerStub: sinon.SinonStubbedInstance<any>
  let expectedCallbackFunction: (_messagePayload: EachMessagePayload) => Promise<void>

  before(() => {
    // Stub the logger
    loggerStub = {
      error: sinon.stub(),
      info: sinon.stub(),
      debug: sinon.stub(),
      createLogger: sinon.stub().returns({
        error: sinon.stub(),
        info: sinon.stub(),
        debug: sinon.stub(),
      }),
    }
    // Stub the producer and consumer
    producerStub = {
      connect: sinon.stub(),
      disconnect: sinon.stub(),
      sendBatch: sinon.stub(),
    }
    consumerStub = {
      connect: sinon.stub(),
      disconnect: sinon.stub(),
      subscribe: sinon.stub(),
      run: (callback: any) => {
        expectedCallbackFunction = callback.eachMessage
      },
    }

    kafkaObjStub = {
      producer: sinon.stub().returns(producerStub),
      consumer: sinon.stub().returns(consumerStub),
    }

    // Create an instance of PgClass with the stubbed Pool
    kafkaClass = new KafkaClass({
      ...standaloneConfig,
      acks: 1,
      logLevel: 'debug',
      compression: 'gzip',
      msgTimeout: 1000,
    });
    (kafkaClass as any).kafkaObj = kafkaObjStub;
    (kafkaClass as any).logger = loggerStub

    kafkaClass2 = new KafkaClass({
      ...standaloneConfig,
      groupId: 'group-id',
    });
    (kafkaClass2 as any).kafkaObj = kafkaObjStub;
    (kafkaClass2 as any).logger = loggerStub
  })

  after(() => {
    // Restore the original methods
    sinon.restore()
  })

  it('Connect, isconnect and disconnect to producer works correctly', async () => {
    producerStub.connect.resetHistory()
    producerStub.disconnect.resetHistory()
    consumerStub.connect.resetHistory()
    consumerStub.disconnect.resetHistory()
    await kafkaClass.connect(true)
    assert.strictEqual(kafkaClass.isconnect(true), true)
    assert.strictEqual(kafkaClass.isconnect(false), false)
    assert(producerStub.connect.callCount === 1)
    assert(consumerStub.connect.callCount === 0)
    await kafkaClass.disconnect(true)
    assert.strictEqual(kafkaClass.isconnect(true), false)
    assert.strictEqual(kafkaClass.isconnect(false), false)
    assert(producerStub.disconnect.callCount === 1)
    assert(consumerStub.disconnect.callCount === 0)
  })

  it('Connect, isconnect and disconnect to consumer works correctly', async () => {
    producerStub.connect.resetHistory()
    producerStub.disconnect.resetHistory()
    consumerStub.connect.resetHistory()
    consumerStub.disconnect.resetHistory()
    await kafkaClass2.connect(false)
    assert.strictEqual(kafkaClass2.isconnect(true), false)
    assert.strictEqual(kafkaClass2.isconnect(false), true)
    assert(producerStub.connect.callCount === 0)
    assert(consumerStub.connect.callCount === 1)
    await kafkaClass2.disconnect(false)
    assert.strictEqual(kafkaClass2.isconnect(true), false)
    assert.strictEqual(kafkaClass2.isconnect(false), false)
    assert(producerStub.disconnect.callCount === 0)
    assert(consumerStub.disconnect.callCount === 1)
  })

  it('Should not able to connect to consumer without groupId', async () => {
    loggerStub.error.resetHistory()
    await kafkaClass.connect(false)
    assert(loggerStub.error.calledOnce)
    assert.strictEqual(loggerStub.error.getCall(0).args[0].event, 'Consumer - connect')
    assert.strictEqual(
      loggerStub.error.getCall(0).args[0].err.message,
      'Invalid Kafka config: groupId is required for consumer',
    )
  })

  it('Should not able to send message if producer is not connected', async () => {
    await assert.rejects(
      async () => {
        await kafkaClass.send([])
      },
      (err: Error) => {
        assert.strictEqual(err.name, 'Error')
        assert.strictEqual(err.message, 'Producer is not connected')
        return true
      },
    )
  })
  it('Should not able to send message if message is empty', async () => {
    producerStub.sendBatch.resetHistory()
    await kafkaClass.connect(true)
    assert.strictEqual(await kafkaClass.send([]), null)
    assert(producerStub.sendBatch.callCount === 0)
  })
  it('Should able to send message', async () => {
    producerStub.sendBatch.resetHistory()
    await kafkaClass.send([
      {
        topic: 'topic', message: 'message', key: 'key1', ingressionTs: 1,
      },
      { topic: 'topic2', message: 'message2', key: 'key3' },
      {
        topic: 'topic', message: 'message', key: 'key2', ingressionTs: 2,
      },
    ])
    assert(producerStub.sendBatch.callCount === 1)
    const expectedCalledMessages = {
      topicMessages: [
        {
          topic: 'topic',
          messages: [
            { key: 'key1', value: 'message', timestamp: 1 },
            { key: 'key2', value: 'message', timestamp: 2 },
          ],
          acks: 1,
          compression: 1,
          timeout: 1000,
        },
        {
          topic: 'topic2',
          messages: [
            { key: 'key3', value: 'message2' }, // this one should have timestamp = Date.now()
          ],
          acks: 1,
          compression: 1,
          timeout: 1000,
        },
      ],
    }
    const actualCalledMessages = producerStub.sendBatch.getCall(0).args[0]
    assert.strictEqual(
      actualCalledMessages.topicMessages.length,
      expectedCalledMessages.topicMessages.length,
    )
    assert.deepStrictEqual(
      actualCalledMessages.topicMessages[0],
      expectedCalledMessages.topicMessages[0],
    )
    assert.strictEqual(
      actualCalledMessages.topicMessages[1].topic,
      expectedCalledMessages.topicMessages[1].topic,
    )
    assert.strictEqual(
      actualCalledMessages.topicMessages[1].messages.length,
      expectedCalledMessages.topicMessages[1].messages.length,
    )
    assert.strictEqual(kafkaClass.sendCount(), 3)
  })

  it('Should not able to subscribe if consumer is not connected', async () => {
    await assert.rejects(
      async () => {
        await kafkaClass2.subscribe([{ topic: 'test-topic', callback: async () => { } }])
      },
      (err: Error) => {
        assert.strictEqual(err.name, 'Error')
        assert.strictEqual(err.message, 'Consumer is not connected')
        return true
      },
    )
  })

  it('Should not able to subscribe if topicList is empty', async () => {
    consumerStub.subscribe.resetHistory()
    await kafkaClass2.connect(false)
    await kafkaClass2.subscribe([])
    assert(consumerStub.subscribe.callCount === 0)
    await kafkaClass2.disconnect(false)
  })

  it('should subscribe correctly', async () => {
    let isFirstTopicCalled = false
    let isSecondTopicCalled = false
    const topicList = [
      { topic: 'test-topic', callback: async () => { isFirstTopicCalled = true } },
      { topic: 'test-topic2', callback: async () => { isSecondTopicCalled = true } },
      { topic: 'invalid-callback-topic', callback: async () => { throw new Error('error') } },
    ]
    consumerStub.subscribe.resetHistory()
    expectedCallbackFunction = async (_messagePayload: EachMessagePayload) => { }
    await kafkaClass2.connect(false)
    await kafkaClass2.subscribe(topicList, true)
    assert(consumerStub.subscribe.calledOnce)
    assert.deepEqual(consumerStub.subscribe.getCall(0).args[0], {
      topics: ['test-topic', 'test-topic2', 'invalid-callback-topic'],
      fromBeginning: true,
    })
    // run function is called so expectedCallbackFunction is set
    const baseMessagePayload = {
      topic: 'test-topic',
      partition: 1,
      message: {
        offset: 'offset',
        timestamp: '1000',
        attributes: 0,
        key: Buffer.from('message-key'),
        headers: {},
        value: Buffer.from('message_content'),
      },
      heartbeat: async () => { },
      pause: () => () => { },
    }
    await expectedCallbackFunction(baseMessagePayload)
    assert(isFirstTopicCalled)
    assert(!isSecondTopicCalled)
    assert.strictEqual(kafkaClass2.receiveCount(), 1)
    await expectedCallbackFunction({
      ...baseMessagePayload,
      topic: 'test-topic2',
    })
    assert(isSecondTopicCalled)
    assert.strictEqual(kafkaClass2.receiveCount(), 2)
    loggerStub.error.resetHistory()
    await expectedCallbackFunction({
      ...baseMessagePayload,
      topic: 'inexistent-topic',
    })
    assert(loggerStub.error.calledOnce)
    loggerStub.error.resetHistory()
    await expectedCallbackFunction({
      ...baseMessagePayload,
      topic: 'invalid-callback-topic',
    })
    assert(loggerStub.error.calledOnce)

    await kafkaClass2.disconnect(false)
  })
})

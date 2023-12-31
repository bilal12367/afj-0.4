// agent.events.on<ConnectionStateChangedEvent>(ConnectionEventTypes.ConnectionStateChanged,(e)=>{
//     console.log("Connected: ",e.payload.connectionRecord)
//   })



import { ConnectionRecord, ConnectionState, CredentialEventTypes, CredentialState, DidsModuleConfig, InitConfig, KeyDidRegistrar, KeyDidResolver, OutOfBandRecord, PeerDidRegistrar, PeerDidResolver, Protocol } from '@aries-framework/core'
import type { Socket } from 'net'

import express from 'express'
import { Server } from 'ws'

import { TestLogger } from '../packages/core/tests/logger'

import {
  ConnectionsModule,
  MediatorModule,
  HttpOutboundTransport,
  Agent,
  ConnectionInvitationMessage,
  LogLevel,
  WsOutboundTransport,
  ConnectionStateChangedEvent,
  ConnectionEventTypes,
  ConsoleLogger,
  CredentialsModule,
  AutoAcceptCredential,
  V2CredentialProtocol,
  ProofsModule,
  AutoAcceptProof,
  V2ProofProtocol,
  DidsModule,
  DidExchangeState,
  CredentialExchangeRecord,
  TypedArrayEncoder,
  KeyType,
} from '@aries-framework/core'
import { HttpInboundTransport, agentDependencies, WsInboundTransport } from '@aries-framework/node'
import { AskarModule } from '@aries-framework/askar'
import { askarModuleConfig } from 'packages/askar/tests/helpers'
import { IndySdkAnonCredsRegistry, IndySdkIndyDidRegistrar, IndySdkIndyDidResolver, IndySdkModule, IndySdkSovDidResolver } from '@aries-framework/indy-sdk'

import { AnonCredsRsModule } from '@aries-framework/anoncreds-rs'
import { anoncreds } from 'packages/anoncreds-rs/tests/helpers'
import { AnonCredsCredentialFormatService, AnonCredsModule, AnonCredsProofFormatService, AnonCredsSchema, GetSchemaReturn, LegacyIndyCredentialFormatService, LegacyIndyProofFormatService, V1CredentialProtocol, V1ProofProtocol } from '@aries-framework/anoncreds'
import { IndyVdrAnonCredsRegistry, IndyVdrIndyDidRegistrar, IndyVdrIndyDidResolver, IndyVdrModule, IndyVdrSovDidResolver } from '@aries-framework/indy-vdr'
import { CheqdAnonCredsRegistry, CheqdDidRegistrar, CheqdDidResolver, CheqdModule, CheqdModuleConfig } from '@aries-framework/cheqd'
import { indyNetworkConfig } from 'demo/src/BaseAgent'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs';
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
import indySdk from 'indy-sdk'

const port = 4006

// We create our own instance of express here. This is not required
// but allows use to use the same server (and port) for both WebSockets and HTTP
const app = express()
app.use(express.json())

let schemas = []
let credDef = []
const socketServer = new Server({ noServer: true })

const endpoints = [`http://192.168.0.7:${port}`, `ws://192.168.0.7:${port}`]

const logger = new TestLogger(LogLevel.info)


const getLegacyIndySdkModules = (genesisTransaction: string) => {
  const legacyIndyCredentialFormatService = new LegacyIndyCredentialFormatService()
  const legacyIndyProofFormatService = new LegacyIndyProofFormatService()
  return {
    ariesAskar: new AskarModule({
      ariesAskar,
    }),
    anoncreds: new AnonCredsModule({
      registries: [new IndyVdrAnonCredsRegistry()],

    }),
    anoncredsRs: new AnonCredsRsModule({
      anoncreds
    }),
    connections: new ConnectionsModule({
      autoAcceptConnections: true,

    }),
    dids: new DidsModule({
      resolvers: [new KeyDidResolver(), new PeerDidResolver(), new IndyVdrIndyDidResolver()],
      registrars: [new KeyDidRegistrar(), new PeerDidRegistrar(), new IndyVdrIndyDidRegistrar()],

    }),

    // indySdk: new IndySdkModule({
    //   indySdk,
    //   networks: [{
    //     isProduction: false,
    //     // indyNamespace: 'bcovrin:test::test:test',
    //     indyNamespace: 'bcovrin',
    //     genesisTransactions: genesisTransaction,
    //     connectOnStartup: true,

    //   }],
    // }),
    indyVdr: new IndyVdrModule({
      indyVdr,
      networks: [{
        isProduction: false,
        indyNamespace: 'bcovrin',
        genesisTransactions: genesisTransaction,
        connectOnStartup: true,
      }],
    }),
    credentials: new CredentialsModule({
      autoAcceptCredentials: AutoAcceptCredential.Always,
      credentialProtocols: [
        new V2CredentialProtocol({
          credentialFormats: [new LegacyIndyCredentialFormatService(), new AnonCredsCredentialFormatService()],
        }),
      ],
    }),
    proofs: new ProofsModule({
      autoAcceptProofs: AutoAcceptProof.Always,
      proofProtocols: [
        new V2ProofProtocol({
          proofFormats: [new LegacyIndyProofFormatService(), new AnonCredsProofFormatService()]
        })
      ]
    })

  } as const
}

const createAndRegisterDidIndy = async (issuer: Agent) => {
  const seed = TypedArrayEncoder.fromString('demoagentissuer00000000000000000')
  const unDid = 'Sdhf7FUUBfyKiXYPKpdToo'
  const indyDid = 'did:indy:bcovrin:' + unDid

  await issuer.dids.import({
    did: indyDid,
    overwrite: true,
    privateKeys: [{
      privateKey: seed,
      keyType: KeyType.Ed25519
    }]
  })
}

const getGenesisTransaction = async (url: string) => {
  const response = await fetch(url)

  return await response.text()
}

const createNewInvitation = async (issuer: Agent, req: any, res: any) => {
  // const outOfBandRecord = await issuer.oob.createInvitation();
  // let invitationUrl = outOfBandRecord.outOfBandInvitation.toUrl({ domain: 'http://192.168.0.5:4001/invitation' })
  // console.log("Creating New Invitation", invitationUrl)
  let invitationUrl: any;
  if (typeof req.query.c_i === 'string') {
    const invitation = ConnectionInvitationMessage.fromUrl(req.url)
    invitationUrl = invitation;
    res.send(invitation.toJSON())
    return {
      invitationUrl: invitationUrl,
      outOfBandRecord: {}
    }
  } else {
    const outOfBandRecord = await issuer.oob.createInvitation()
    const httpEndpoint = endpoints.find((e) => e.startsWith('http'))
    invitationUrl = outOfBandRecord.outOfBandInvitation.toUrl({ domain: httpEndpoint + '/invitation' })
    res.send(invitationUrl)
    return {
      invitationUrl: invitationUrl,
      outOfBandRecord,
    }
  }
}
const registerSchema = async (issuer: Agent) => {
  const schemaResult = await issuer.modules.anoncreds.registerSchema({
    schema: {
      attrNames: ['name', 'score'],
      issuerId: 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo',
      name: 'Example Schema to register',
      version: '1.0.0',
    },
    options: {},
  })
  schemas.push(schemaResult.schemaState.schemaId)
  if (schemaResult.schemaState.state === 'failed') {
    console.log("Error: ", schemaResult.schemaState.reason)
    return '';
  } else {
    return schemaResult;
  }
  // return issuer.ledger.registerSchema({ attributes: ['name', 'age'], name: 'Schema6', version: '1.0' })
}

const createCredDef = async (schemaResult: any, agent: Agent) => {
  console.log('Schema Id: ', schemaResult.schemaState.schemaId)
  const credentialDefinitionResult = await agent.modules.anoncreds.registerCredentialDefinition({
    credentialDefinition: {
      tag: 'My University 1',
      issuerId: 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo',
      schemaId: schemaResult.schemaState.schemaId,
    },
    options: {},
  })

  if (credentialDefinitionResult.credentialDefinitionState.state === 'failed') {
    console.log(`Error creating credential definition: ${credentialDefinitionResult.credentialDefinitionState.reason}`)

  } else {
    // console.log("Credential Def result1234:", credentialDefinitionResult)
    const credDefId = credentialDefinitionResult.credentialDefinitionState.credentialDefinitionId
    console.log({ schemaId: schemaResult.schemaState.schemaId, credDefId })

  }

  return ''
}

const setupConnectionListener = (
  issuer: Agent,
  // outOfBandRecord: OutOfBandRecord,
  // outOfBandRecord: OutOfBandRecord,
) => {

  issuer.events.on(ConnectionEventTypes.ConnectionStateChanged, async (e: any) => {
    console.log("Connection Event: ", e.payload.connectionRecord.state)
    // the connection is now ready for usage in other protocols!
    // Custom business logic can be included here
    // In this example we can send a basic message to the connection, but
    // anything is possible
    // await flow(payload.connectionRecord.id)
    // console.log(`Connection for out-of-band id ${outOfBandRecord.id} completed`)
    // console.log("Connection Record: ", e.payload.connectionRecord.id)

    const ConnectionRecord: ConnectionRecord = e.payload.connectionRecord
    console.log('ConnectionRecord', ConnectionRecord)
    if (e.payload.connectionRecord.state == 'completed') {

      const connectionId: string = ConnectionRecord.id;
      console.log("--------------------------------------")
      console.log("--------------------------------------")
      console.log({ connectionId })
      console.log("--------------------------------------")
      console.log("--------------------------------------")
      // const unDid = 'Sdhf7FUUBfyKiXYPKpdToo'
      // const indyDid = 'did:indy:bcovrin:' + unDid
      // const connectionId = e.payload.connectionRecord.id;
      const schemaId = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo/anoncreds/v0/SCHEMA/Example Schema to register/1.0.0'

      const credentialDefinitionId = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo/anoncreds/v0/CLAIM_DEF/7/My University 1'

      const anonCredsCredentialExchangeRecord = await issuer.credentials.offerCredential({
        protocolVersion: 'v2' as never,
        connectionId: connectionId,
        credentialFormats: {
          anoncreds: {
            credentialDefinitionId: credentialDefinitionId,
            attributes: [
              { name: 'name', value: 'Bilal' },
              { name: 'score', value: '300' },
            ],
          },
        },
      })
    }
    // console.log('anonCredsCredentialExchangeRecord:  ', anonCredsCredentialExchangeRecord)
    // const credentialDefinitionResult = await issuer.modules.anoncreds.registerCredentialDefinition({
    //   credentialDefinition: {
    //     tag: 'My Organization',
    //     issuerId: indyDid,
    //     schemaId: schemaId,
    //   },
    //   options: {},
    // })

    // console.log('credentialDefinitionResult1234: ', credentialDefinitionResult)
    // try {
    //   const schemaResult = await issuer.modules.anoncreds.registerSchema({
    //     schema: {
    //       attrNames: ['name'],
    //       issuerId: indyDid,
    //       name: 'Example Schema to register',
    //       version: '1.0.0',
    //     },
    //     options: {},
    //   })
    //   console.log('schemaResult1234:', schemaResult)
    // } catch (error) {
    //   console.log("Schema Error: ",error)
    // }
    // const schemaResult = await registerSchema(issuer);
    // await createCredDef(schemaResult, issuer, connectionId) as string;

  })

  issuer.events.on(CredentialEventTypes.CredentialStateChanged, async (e: any) => {
    console.log("Credential State Changed: ", e);
    if (e.payload.credentialRecord.state === CredentialState.Done) {
      const connectionId = e.payload.credentialRecord.connectionId;
      const credentialId = e.payload.credentialRecord.id;
      const credentialDefinitionId = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo/anoncreds/v0/CLAIM_DEF/7/My Organization'
      const proofAttribute = {
        name: {
          name: 'name',
          restrictions: [
            {
              cred_def_id: credentialDefinitionId,
            },
          ],
        },
      }
      console.log("Sending Proof Request: ", { connectionId, credentialId, credentialDefinitionId })
      await issuer.proofs.requestProof({
        protocolVersion: 'v2',
        connectionId: connectionId,
        proofFormats: {
          anoncreds: {
            name: 'proof-request',
            version: '1.0',
            requested_attributes: proofAttribute,
          },
        },
      })
    }
  })
}

const run = async () => {
  console.log("Started")

  const agentConfig: InitConfig = {
    endpoints,
    label: "AFJ Issuer 0.4",
    walletConfig: {
      id: 'demo-agent-issuer',
      key: 'demoagentissuer00000000000000000',
    },
    logger,
    useDidSovPrefixWhereAllowed: true,
    autoUpdateStorageOnStartup: true
  }

  const genesisTransaction: string = await getGenesisTransaction('http://192.168.0.7:9000/genesis')
  // const genesisTransaction: string = await getGenesisTransaction('http://13.235.107.142:9000/genesis')
  // Set up agent
  // genesisTransaction.replaceAll('192.168.0.5','127.0.0.1')
  console.log('genesisTransaction', genesisTransaction)
  const agent: Agent = new Agent({
    config: agentConfig,
    dependencies: agentDependencies,
    modules: getLegacyIndySdkModules(genesisTransaction),

  })
  const config = agent.config

  // Create all transports
  const httpInboundTransport = new HttpInboundTransport({ app, port })
  const httpOutboundTransport = new HttpOutboundTransport()
  const wsInboundTransport = new WsInboundTransport({ server: socketServer })
  const wsOutboundTransport = new WsOutboundTransport()

  // Register all Transports
  agent.registerInboundTransport(httpInboundTransport)
  agent.registerOutboundTransport(httpOutboundTransport)
  agent.registerInboundTransport(wsInboundTransport)
  agent.registerOutboundTransport(wsOutboundTransport)

  await agent.initialize()

  setupConnectionListener(agent)
  await createAndRegisterDidIndy(agent)

  // if(schemas.length == 0) {

  //   const schemaResult = await registerSchema(agent);
  //   await createCredDef(schemaResult, agent)
  // }


  httpInboundTransport.app.use(express.json())
  httpInboundTransport.app.get('/invitation', async (req, res) => {
    const resp = await createNewInvitation(agent, req, res)
    console.log("Invitation URL: ", resp.invitationUrl)
    // let oob : OutOfBandRecord = resp.outOfBandRecord as OutOfBandRecord;  
    // setupConnectionListener(agent, resp.outOfBandRecord as OutOfBandRecord)
    // await agent.connections.returnWhenIsConnected(oob.id,{timeoutMs: 10000})
    // console.log("Connected id: ", oob.id)

    // res.send(resp.invitationUrl)
  })

  httpInboundTransport.app.post('/send_proof', async (req, res) => {
    console.log('request.body: ', req.body)
    const { connectionId } = req.body
    const indyDid = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo'
    const schemaId = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo/anoncreds/v0/SCHEMA/Example Schema to register/1.0.0'
    const credentialDefinitionId = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo/anoncreds/v0/CLAIM_DEF/7/My University 1'
    const proofAttribute = {
      name: {
        name: 'name',
        restrictions: [
          {
            cred_def_id: credentialDefinitionId,
          },
        ],
      },
      score: {
        name: 'score',
        restrictions: [
          {
            cred_def_id: credentialDefinitionId,
          },
        ],
      },
    }
    if (!connectionId) {
      res.json({ "error": "connection id is missing." })
    } else {
      const proof = await agent.proofs.requestProof({
        protocolVersion: 'v2',
        connectionId: connectionId,
        proofFormats: {
          anoncreds: {
            name: 'proof-request',
            version: '1.0',
            requested_attributes: proofAttribute,
          },
        },
      })
      res.json({ proof })
    }
  })

  httpInboundTransport.app.post('/send_offer', async (req, res) => {
    console.log('request.body', req.body)
    const { connectionId, name } = req.body;
    const indyDid = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo'
    const schemaId = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo/anoncreds/v0/SCHEMA/Example Schema to register/1.0.0'
    const credentialDefinitionId = 'did:indy:bcovrin:Sdhf7FUUBfyKiXYPKpdToo/anoncreds/v0/CLAIM_DEF/7/My University 1'

    if (!connectionId && !name) {
      res.json({ "error": "connection id or name are missing." })
    } else {

      const anonCredsCredentialExchangeRecord = await agent.credentials.offerCredential({
        protocolVersion: 'v2' as never,
        connectionId: connectionId,
        credentialFormats: {
          anoncreds: {
            credentialDefinitionId: credentialDefinitionId,
            attributes: [
              { name: 'name', value: name },
              { name: 'score', value: '300' },
            ],
          },
        },
      })
      res.json({ credential: anonCredsCredentialExchangeRecord })
    }
  })
  httpInboundTransport.app.post('/schemas', async (req, res) => {

  })
  httpInboundTransport.app.post('/connections', async (req, res) => {
    console.log("Endpoint: Connections")
    console.log("Body: ", req.body)
    const connections = await agent.connections.getAll();
    console.log("Connections: ", connections);
    res.json({ connections })
  })
  // app.get('/invitation', async (req, res) => {
  //   const resp = await createNewInvitation(agent,req,res)
  //   console.log("Invitation URL: ", resp.invitationUrl)
  //   setupConnectionListener(agent, resp.outOfBandRecord)
  //   // res.send(resp.invitationUrl)
  // })

  // app.listen(3026, () => {
  //   console.log("Server started listening at 3026...")
  // })

  // When an 'upgrade' to WS is made on our http server, we forward the
  // request to the WS server
  httpInboundTransport.server?.on('upgrade', (request, socket, head) => {
    socketServer.handleUpgrade(request, socket as Socket, head, (socket) => {
      socketServer.emit('connection', socket, request)
    })
  })
}

void run()



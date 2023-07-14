// agent.events.on<ConnectionStateChangedEvent>(ConnectionEventTypes.ConnectionStateChanged,(e)=>{
//     console.log("Connected: ",e.payload.connectionRecord)
//   })




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
} from '@aries-framework/core'
import { HttpInboundTransport, agentDependencies, WsInboundTransport } from '@aries-framework/node'
import { AskarModule } from '@aries-framework/askar'
import { askarModuleConfig } from 'packages/askar/tests/helpers'
import { IndySdkModule } from '@aries-framework/indy-sdk'
import { genesisTransactions, indySdk } from 'packages/core/tests'
import { AnonCredsRsModule } from '@aries-framework/anoncreds-rs'
import { anoncreds } from 'packages/anoncreds-rs/tests/helpers'
import { AnonCredsCredentialFormatService, AnonCredsModule, AnonCredsProofFormatService, GetSchemaReturn, LegacyIndyCredentialFormatService, LegacyIndyProofFormatService, V1CredentialProtocol, V1ProofProtocol } from '@aries-framework/anoncreds'
import { IndyVdrAnonCredsRegistry, IndyVdrIndyDidRegistrar, IndyVdrIndyDidResolver, IndyVdrModule } from '@aries-framework/indy-vdr'
import { CheqdAnonCredsRegistry, CheqdDidRegistrar, CheqdDidResolver, CheqdModule, CheqdModuleConfig } from '@aries-framework/cheqd'
import { indyNetworkConfig } from 'demo/src/BaseAgent'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs';
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'

const port = process.env.AGENT_PORT ? Number(process.env.AGENT_PORT) : 4001

// We create our own instance of express here. This is not required
// but allows use to use the same server (and port) for both WebSockets and HTTP
const app = express()
const socketServer = new Server({ noServer: true })

const endpoints = [`http://192.168.0.7:${port}`, `wss://192.168.0.7:${port}`]

const logger = new TestLogger(LogLevel.info)

const getGenesisTransaction = async (url) => {
  const response = await fetch(url)

  return await response.text()
}


// Allow to create invitation, no other way to ask for invitation yet
// httpInboundTransport.app.get('/invitation', async (req, res) => {
//   if (typeof req.query.c_i === 'string') {
//     const invitation = ConnectionInvitationMessage.fromUrl(req.url)
//     res.send(invitation.toJSON())
//   } else {
//     const { outOfBandInvitation } = await agent.oob.createInvitation()
//     const httpEndpoint = config.endpoints.find((e) => e.startsWith('http'))
//     res.send(outOfBandInvitation.toUrl({ domain: httpEndpoint + '/invitation' }))
//   }
// })

const createNewInvitation = async (issuer) => {
  const outOfBandRecord = await issuer.oob.createInvitation();
  let invitationUrl = outOfBandRecord.outOfBandInvitation.toUrl({ domain: 'http://192.168.0.7:4001/invitation' })
  console.log("Creating New Invitation", invitationUrl)
  return {
    invitationUrl: invitationUrl,
    outOfBandRecord,
  }
}
const registerSchema = async (issuer) => {
  const schemaResult = await issuer.modules.anoncreds.registerSchema({
    schema: {
      attrNames: ['name', 'score'],
      issuerId: 'Sdhf7FUUBfyKiXYPKpdToo',
      name: 'Example Schema to register',
      version: '1.0.0',
    },
    options: {},
  })
  if (schemaResult.schemaState.state === 'failed') {
    console.log("Error: ", schemaResult.schemaState.reason)
    return '';
  } else {
    return schemaResult;
  }
  // return issuer.ledger.registerSchema({ attributes: ['name', 'age'], name: 'Schema6', version: '1.0' })
}

const createCredDef = async (schemaResult, agent,connectionId) => {
  const credentialDefinitionResult = await agent.modules.anoncreds.registerCredentialDefinition({
    credentialDefinition: {
      tag: 'My University 1',
      issuerId: 'Sdhf7FUUBfyKiXYPKpdToo',
      schemaId: schemaResult.schemaState.schemaId,
    },
    options: {},
  })

  if (credentialDefinitionResult.credentialDefinitionState.state === 'failed') {
    console.log(`Error creating credential definition: ${credentialDefinitionResult.credentialDefinitionState.reason}`)
    
  } else {
    console.log("Credential Def result1234:", credentialDefinitionResult)
    const credDefId = credentialDefinitionResult.credentialDefinitionState.credentialDefinitionId

    
    await agent.credentials.offerCredential({
      protocolVersion: 'v2',
      connectionId: connectionId,
      credentialFormats: {
        indy: {
          credentialDefinitionId: credDefId,
          attributes: [
            { name: 'name', value: 'Bilal' },
            { name: 'score', value: '230' },
          ],
        },
      },
    })
    
  }

  return ''
}

const setupConnectionListener = (
  issuer,
  outOfBandRecord,
  flow
) => {

  console.log("Setting Connection Listener ", outOfBandRecord.id)
  issuer.events.on(ConnectionEventTypes.ConnectionStateChanged, async (e) => {
    console.log("Connection Event: ", e)
    if (e.payload.connectionRecord.outOfBandId !== outOfBandRecord.id) return
    if (e.payload.connectionRecord.state === DidExchangeState.Completed) {
      // the connection is now ready for usage in other protocols!
      console.log(`Connection for out-of-band id ${outOfBandRecord.id} completed`)
      const connectionId = outOfBandRecord.id;
      // Custom business logic can be included here
      // In this example we can send a basic message to the connection, but
      // anything is possible
      // await flow(payload.connectionRecord.id)
      const schemaResult = await registerSchema(issuer);
      await createCredDef(schemaResult, issuer, connectionId) ;


     

    }
  })
}
const run = async () => {
  console.log("Started")

  const agentConfig = {
    endpoints,
    label: "AFJ Issuer 0.4",
    walletConfig: {
      id: 'demo-agent-issuer',
      key: 'demoagentissuer00000000000000000',
    },
    logger,
  }
  const genesisTransaction = await getGenesisTransaction('http://192.168.0.7:9000/genesis')
  console.log('genesisTransaction', genesisTransaction)
  // Set up agent

  const agent = new Agent({
    config: agentConfig,
    dependencies: agentDependencies,
    modules: getAskarAnonCredsIndyModules(genesisTransaction)
  })
  const config = agent.config

  // Create all transports
  const httpInboundTransport = new HttpInboundTransport({ app, port })
  const httpOutboundTransport = new HttpOutboundTransport()
  // const wsInboundTransport = new WsInboundTransport({ server: socketServer })
  const wsOutboundTransport = new WsOutboundTransport()

  // Register all Transports
  agent.registerInboundTransport(httpInboundTransport)
  agent.registerOutboundTransport(httpOutboundTransport)
  // agent.registerInboundTransport(wsInboundTransport)
  agent.registerOutboundTransport(wsOutboundTransport)

  await agent.initialize()

  httpInboundTransport.app.get('/invitation', async (req, res) => {
    const resp = await createNewInvitation(agent)
    console.log("Invitation URL: ", resp.invitationUrl)
    setupConnectionListener(agent, resp.outOfBandRecord, 'flow()')
    res.send(resp.invitationUrl)
  })

  app.get('/invitation', async (req, res) => {
    const resp = await createNewInvitation(agent)
    console.log("Invitation URL: ", resp.invitationUrl)
    setupConnectionListener(agent, resp.outOfBandRecord, 'flow()')
    res.send(resp.invitationUrl)
  })

  app.listen(3006, () => {
    console.log("Server started listening at 3006...")
  })

  // When an 'upgrade' to WS is made on our http server, we forward the
  // request to the WS server
  httpInboundTransport.server?.on('upgrade', (request, socket, head) => {
    socketServer.handleUpgrade(request, socket , head, (socket) => {
      socketServer.emit('connection', socket, request)
    })
  })
}

void run()


function getAskarAnonCredsIndyModules(genesisTransaction) {
  const legacyIndyCredentialFormatService = new LegacyIndyCredentialFormatService()
  const legacyIndyProofFormatService = new LegacyIndyProofFormatService()

  return {
    connections: new ConnectionsModule({
      autoAcceptConnections: true,
    }),
    credentials: new CredentialsModule({
      autoAcceptCredentials: AutoAcceptCredential.ContentApproved,
      credentialProtocols: [
        new V1CredentialProtocol({
          indyCredentialFormat: legacyIndyCredentialFormatService,
        }),
        new V2CredentialProtocol({
          credentialFormats: [legacyIndyCredentialFormatService, new AnonCredsCredentialFormatService()],
        }),
      ],
    }),
    proofs: new ProofsModule({
      autoAcceptProofs: AutoAcceptProof.ContentApproved,
      proofProtocols: [
        new V1ProofProtocol({
          indyProofFormat: legacyIndyProofFormatService,
        }),
        new V2ProofProtocol({
          proofFormats: [legacyIndyProofFormatService, new AnonCredsProofFormatService()],
        }),
      ],
    }),
    anoncreds: new AnonCredsModule({
      registries: [new IndyVdrAnonCredsRegistry(), new CheqdAnonCredsRegistry()],
    }),
    anoncredsRs: new AnonCredsRsModule({
      anoncreds,
    }),
    indyVdr: new IndyVdrModule({
      indyVdr,
      networks: [{
        isProduction: false,
        indyNamespace: 'bcovrin:test',
        genesisTransactions: genesisTransactions,
        connectOnStartup: true,
      },],
    }),
    cheqd: new CheqdModule(
      new CheqdModuleConfig({
        networks: [
          {
            network: 'testnet',
            cosmosPayerSeed:
              'robust across amount corn curve panther opera wish toe ring bleak empower wreck party abstract glad average muffin picnic jar squeeze annual long aunt',
          },
        ],
      })
    ),
    dids: new DidsModule({
      resolvers: [new IndyVdrIndyDidResolver(), new CheqdDidResolver()],
      registrars: [new CheqdDidRegistrar()],
    }),
    askar: new AskarModule({
      ariesAskar,
    }),
  } 
}

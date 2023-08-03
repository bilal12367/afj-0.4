/**
 * This file contains a sample mediator. The mediator supports both
 * HTTP and WebSockets for communication and will automatically accept
 * incoming mediation requests.
 *
 * You can get an invitation by going to '/invitation', which by default is
 * http://192.168.0.5:3001/invitation
 *
 * To connect to the mediator from another agent, you can set the
 * 'mediatorConnectionsInvite' parameter in the agent config to the
 * url that is returned by the '/invitation/ endpoint. This will connect
 * to the mediator, request mediation and set the mediator as default.
 */

import type { InitConfig } from '@aries-framework/core'
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
} from '@aries-framework/core'
import { HttpInboundTransport, agentDependencies, WsInboundTransport } from '@aries-framework/node'
import { AskarModule } from '@aries-framework/askar'
import { askarModuleConfig } from 'packages/askar/tests/helpers'
import { IndySdkModule } from '@aries-framework/indy-sdk'
import { indySdk } from 'packages/core/tests'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
const port = 6001

// We create our own instance of express here. This is not required
// but allows use to use the same server (and port) for both WebSockets and HTTP
const app = express()
const socketServer = new Server({ noServer: true })

const endpoints = [`http://192.168.0.7:${port}`, `ws://192.168.0.7:${port}`]

const logger = new TestLogger(LogLevel.info)

const run = async () => {
  console.log("Started")
  const agentConfig: InitConfig = {
    endpoints,
    label: process.env.AGENT_LABEL || 'Aries Framework JavaScript Mediator',
    walletConfig: {
      id: process.env.WALLET_NAME || 'AriesFrameworkJavaScript',
      key: process.env.WALLET_KEY || 'AriesFrameworkJavaScript',
    },
    logger,
  }

  // Set up agent
  const agent = new Agent({
    config: agentConfig,
    dependencies: agentDependencies,
    modules: {
      ariesAskar: new AskarModule({
        ariesAskar
      }),
      mediator: new MediatorModule({
        autoAcceptMediationRequests: true,
      }),
      connections: new ConnectionsModule({
        autoAcceptConnections: true,
      }),
    },
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

  // Allow to create invitation, no other way to ask for invitation yet
  httpInboundTransport.app.get('/invitation', async (req, res) => {
    if (typeof req.query.c_i === 'string') {
      const invitation = ConnectionInvitationMessage.fromUrl(req.url)
      res.send(invitation.toJSON())
    } else {
      const { outOfBandInvitation } = await agent.oob.createInvitation({multiUseInvitation: true})
      const httpEndpoint = config.endpoints.find((e) => e.startsWith('http'))
      res.send(outOfBandInvitation.toUrl({ domain: httpEndpoint + '/invitation' }))
    }
  })
  await agent.initialize()


  // When an 'upgrade' to WS is made on our http server, we forward the
  // request to the WS server
  httpInboundTransport.server?.on('upgrade', (request, socket, head) => {
    console.log("Flag1")
    socketServer.handleUpgrade(request, socket as Socket, head, (socket) => {
      console.log("Flag2")
      socketServer.emit('connection', socket, request)
    })
  })
}

void run()

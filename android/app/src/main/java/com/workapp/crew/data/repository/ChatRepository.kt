package com.workapp.crew.data.repository

import com.workapp.crew.data.local.dao.ChatDao
import com.workapp.crew.data.local.entities.ChatChannelEntity
import com.workapp.crew.data.local.entities.ChatMessageEntity
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.AuthTokenStore
import com.workapp.crew.di.SOCKET_ORIGIN
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Feature 5: real-time chat between field techs and dispatch. REST loads channel list/history;
 * Socket.IO carries live messages while the app is foregrounded. Message send is optimistic —
 * written to Room immediately, then emitted; the ack flips it to synced once the server confirms. */
@Singleton
class ChatRepository @Inject constructor(
    private val dao: ChatDao,
    private val api: ApiService,
    private val tokenStore: AuthTokenStore,
) {
    private var socket: Socket? = null
    // Socket event callbacks arrive off any ViewModel's lifecycle, so local persistence needs its
    // own scope rather than borrowing a screen's (which may already be gone by the time an ack lands).
    private val repositoryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun connect() {
        val token = tokenStore.accessToken ?: return
        if (socket?.connected() == true) return

        socket?.disconnect()
        val options = IO.Options.builder()
            .setPath("/ws/chat")
            .setAuth(mapOf("token" to token))
            .setReconnection(true)
            .build()
        socket = IO.socket(java.net.URI.create(SOCKET_ORIGIN), options).also { it.connect() }
    }

    fun disconnect() {
        socket?.disconnect()
        socket = null
    }

    fun joinChannel(channelId: String) {
        socket?.emit("channel:join", channelId)
    }

    /** Messages broadcast by *this* device are filtered out here — they're already reflected via
     * the optimistic local insert in [sendMessage] and reconciled by its ack, so re-inserting the
     * echoed broadcast would duplicate the row (see the docstring on [sendMessage]). */
    fun observeIncomingMessages(currentUserId: String): Flow<Unit> = callbackFlow {
        val listener = io.socket.emitter.Emitter.Listener { args ->
            val payload = args.getOrNull(0) as? JSONObject ?: return@Listener
            val senderId = payload.optString("senderId")
            if (senderId == currentUserId) return@Listener // our own echoed broadcast; see sendMessage's ack path

            trySend(Unit)
            repositoryScope.launch {
                dao.insertMessage(
                    ChatMessageEntity(
                        clientMsgId = payload.optString("id"),
                        serverId = payload.optString("id"),
                        channelId = payload.optString("channelId"),
                        senderId = senderId,
                        body = payload.optString("body", null),
                        attachmentLocalPath = null,
                        sentAt = runCatching { Instant.parse(payload.optString("sentAt")).toEpochMilli() }.getOrDefault(System.currentTimeMillis()),
                        synced = true,
                    ),
                )
            }
        }
        socket?.on("message:new", listener)
        awaitClose { socket?.off("message:new", listener) }
    }

    suspend fun refreshChannels() {
        val channels = api.getChatChannels()
        dao.upsertChannels(channels.map { ChatChannelEntity(id = it.id, type = it.type, name = it.name, jobId = it.job_id) })
    }

    fun observeChannels() = dao.observeChannels()
    fun observeMessages(channelId: String) = dao.observeMessages(channelId)

    suspend fun loadHistory(channelId: String) {
        val messages = api.getChatMessages(channelId)
        for (dto in messages) {
            dao.insertMessage(
                ChatMessageEntity(
                    clientMsgId = dto.id,
                    serverId = dto.id,
                    channelId = channelId,
                    senderId = dto.sender_id,
                    body = dto.body,
                    attachmentLocalPath = null,
                    sentAt = runCatching { Instant.parse(dto.sent_at).toEpochMilli() }.getOrDefault(System.currentTimeMillis()),
                    synced = true,
                ),
            )
        }
    }

    fun sendMessage(channelId: String, senderId: String, body: String) {
        val clientMsgId = UUID.randomUUID().toString()
        // Optimistic local write so the sender sees the message instantly, before the server (or
        // even the socket connection) confirms anything.
        repositoryScope.launch {
            dao.insertMessage(
                ChatMessageEntity(
                    clientMsgId = clientMsgId,
                    serverId = null,
                    channelId = channelId,
                    senderId = senderId,
                    body = body,
                    attachmentLocalPath = null,
                    sentAt = System.currentTimeMillis(),
                    synced = false,
                ),
            )
        }

        val payload = JSONObject().apply {
            put("channelId", channelId)
            put("body", body)
            put("clientMsgId", clientMsgId)
        }
        socket?.emit("message:send", arrayOf(payload), Ack { args ->
            val result = args.getOrNull(0) as? JSONObject ?: return@Ack
            val serverId = result.optString("id").takeIf { it.isNotEmpty() } ?: return@Ack
            repositoryScope.launch { dao.markSynced(clientMsgId, serverId) }
        })
    }
}

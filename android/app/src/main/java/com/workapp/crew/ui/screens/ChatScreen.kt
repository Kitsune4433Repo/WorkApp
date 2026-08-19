package com.workapp.crew.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.local.entities.ChatChannelEntity
import com.workapp.crew.data.local.entities.ChatMessageEntity
import com.workapp.crew.data.repository.AuthRepository
import com.workapp.crew.data.repository.ChatRepository
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

private val ROOM_CREATE_ROLES = setOf("admin")

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val repository: ChatRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {
    val currentUserId = authRepository.currentUserId
    val canCreateRoom = authRepository.currentRole in ROOM_CREATE_ROLES

    val channels = repository.observeChannels().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    var creatingRoom by mutableStateOf(false)
        private set
    var createRoomError by mutableStateOf<String?>(null)
        private set

    private val activeChannelId = MutableStateFlow<String?>(null)

    @OptIn(ExperimentalCoroutinesApi::class)
    val messages: StateFlow<List<ChatMessageEntity>> = activeChannelId
        .flatMapLatest { channelId -> channelId?.let(repository::observeMessages) ?: flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        repository.connect()
        viewModelScope.launch { repository.refreshChannels() }
        currentUserId?.let { userId ->
            viewModelScope.launch {
                repository.observeIncomingMessages(userId).collect { /* Room flow already reactive */ }
            }
        }
    }

    fun refreshChannels() = viewModelScope.launch { repository.refreshChannels() }

    fun createRoom(name: String, onDone: (channelId: String) -> Unit) {
        creatingRoom = true
        createRoomError = null
        viewModelScope.launch {
            try {
                val id = repository.createBroadcastRoom(name)
                onDone(id)
            } catch (e: retrofit2.HttpException) {
                createRoomError = if (e.code() == 403) "Only admins can create rooms." else "Failed to create room (${e.code()})."
            } catch (e: java.io.IOException) {
                createRoomError = "Can't reach the server. Check your connection."
            } finally {
                creatingRoom = false
            }
        }
    }

    fun selectChannel(channelId: String) {
        activeChannelId.value = channelId
        repository.joinChannel(channelId)
        viewModelScope.launch { repository.loadHistory(channelId) }
    }

    fun send(body: String) {
        val channelId = activeChannelId.value ?: return
        val userId = currentUserId ?: return
        if (body.isBlank()) return
        repository.sendMessage(channelId, userId, body.trim())
    }

    override fun onCleared() {
        repository.disconnect()
        super.onCleared()
    }
}

/** Feature 5: real-time chat with the dispatch office and crew. */
@Composable
fun ChatScreen(viewModel: ChatViewModel = hiltViewModel()) {
    val channels by viewModel.channels.collectAsState()
    val messages by viewModel.messages.collectAsState()
    var activeChannelId by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    // The channel list has no live push of its own (only messages ride the socket) — poll so a
    // room an admin creates elsewhere shows up here without restarting the screen.
    PeriodicRefresh { viewModel.refreshChannels() }

    Row(Modifier.fillMaxSize()) {
        Column(Modifier.width(140.dp).fillMaxHeight().padding(8.dp)) {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(channels, key = { it.id }) { channel ->
                    ChannelChip(
                        channel = channel,
                        selected = activeChannelId == channel.id,
                        onClick = {
                            activeChannelId = channel.id
                            viewModel.selectChannel(channel.id)
                        },
                    )
                }
            }
            if (viewModel.canCreateRoom) {
                CreateRoomControl(
                    saving = viewModel.creatingRoom,
                    error = viewModel.createRoomError,
                    onCreate = { name -> viewModel.createRoom(name) { id -> activeChannelId = id; viewModel.selectChannel(id) } },
                )
            }
        }

        Column(Modifier.weight(1f).fillMaxHeight().padding(8.dp)) {
            if (activeChannelId == null) {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text("Select a channel to start messaging.", style = MaterialTheme.typography.bodyMedium)
                }
            } else {
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(messages, key = { it.clientMsgId }) { message ->
                        MessageBubble(message = message, isMine = message.senderId == viewModel.currentUserId)
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        placeholder = { Text("Message…") },
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            viewModel.send(draft)
                            draft = ""
                        },
                        modifier = Modifier.align(Alignment.CenterVertically),
                    ) {
                        Text("Send")
                    }
                }
            }
        }
    }
}

@Composable
private fun CreateRoomControl(saving: Boolean, error: String?, onCreate: (name: String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }

    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        if (expanded) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                placeholder = { Text("Room name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(
                    onClick = { onCreate(name.trim()); name = ""; expanded = false },
                    enabled = !saving && name.isNotBlank(),
                ) { Text(if (saving) "Creating…" else "Create") }
                TextButton(onClick = { expanded = false }) { Text("Cancel") }
            }
        } else {
            TextButton(onClick = { expanded = true }) { Text("+ New room") }
        }
    }
}

@Composable
private fun ChannelChip(channel: ChatChannelEntity, selected: Boolean, onClick: () -> Unit) {
    Surface(
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.small,
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            channel.name ?: channel.type.replaceFirstChar { it.uppercase() },
            modifier = Modifier.padding(8.dp),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun MessageBubble(message: ChatMessageEntity, isMine: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start) {
        Surface(
            color = if (isMine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(
                message.body.orEmpty(),
                color = if (isMine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

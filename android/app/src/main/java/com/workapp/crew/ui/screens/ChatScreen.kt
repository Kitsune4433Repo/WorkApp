package com.workapp.crew.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.compose.AsyncImage
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

    fun canDeleteChannel(channel: ChatChannelEntity) =
        authRepository.currentRole == "admin" || channel.createdBy == currentUserId

    var creatingRoom by mutableStateOf(false)
        private set
    var createRoomError by mutableStateOf<String?>(null)
        private set

    var deletingChannelId by mutableStateOf<String?>(null)
        private set

    var sendingAttachment by mutableStateOf(false)
        private set
    var attachmentError by mutableStateOf<String?>(null)
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

    fun deleteChannel(channelId: String, onDone: () -> Unit) {
        deletingChannelId = channelId
        viewModelScope.launch {
            try {
                repository.deleteChannel(channelId)
                onDone()
            } catch (e: Exception) {
                // Best-effort — the room reappears on the next refresh if this failed, which is
                // visible feedback enough without a dedicated error banner for a rare failure.
            } finally {
                deletingChannelId = null
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

    fun sendWithPhoto(uri: Uri, mimeType: String, body: String) {
        val channelId = activeChannelId.value ?: return
        val userId = currentUserId ?: return
        sendingAttachment = true
        attachmentError = null
        viewModelScope.launch {
            try {
                val key = repository.uploadAttachment(uri, mimeType)
                repository.sendMessage(channelId, userId, body.trim(), attachmentUrl = key)
            } catch (e: Exception) {
                attachmentError = "Failed to send photo."
            } finally {
                sendingAttachment = false
            }
        }
    }

    suspend fun signAttachmentUrl(key: String): String = repository.signAttachmentUrl(key)

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
    var pendingPhoto by remember { mutableStateOf<Uri?>(null) }
    var showCreateDialog by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val activeChannel = channels.find { it.id == activeChannelId }

    // The channel list has no live push of its own (only messages ride the socket) — poll so a
    // room an admin creates elsewhere shows up here without restarting the screen.
    PeriodicRefresh { viewModel.refreshChannels() }

    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> pendingPhoto = uri }

    if (showCreateDialog) {
        CreateRoomDialog(
            saving = viewModel.creatingRoom,
            error = viewModel.createRoomError,
            onDismiss = { showCreateDialog = false },
            onCreate = { name ->
                viewModel.createRoom(name) { id ->
                    showCreateDialog = false
                    activeChannelId = id
                    viewModel.selectChannel(id)
                }
            },
        )
    }

    Row(Modifier.fillMaxSize()) {
        Column(Modifier.width(150.dp).fillMaxHeight().padding(8.dp)) {
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
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { showCreateDialog = true }, modifier = Modifier.fillMaxWidth()) {
                    Text("+ New room", style = MaterialTheme.typography.labelMedium)
                }
            }
        }

        Column(Modifier.weight(1f).fillMaxHeight().padding(8.dp)) {
            if (activeChannel != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        activeChannel.name ?: "${activeChannel.type.replaceFirstChar { it.uppercase() }} channel",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    if (viewModel.canDeleteChannel(activeChannel)) {
                        IconButton(
                            onClick = {
                                viewModel.deleteChannel(activeChannel.id) {
                                    activeChannelId = null
                                }
                            },
                            enabled = viewModel.deletingChannelId != activeChannel.id,
                        ) { Icon(Icons.Filled.Delete, contentDescription = "Delete room", tint = MaterialTheme.colorScheme.error) }
                    }
                }
                Spacer(Modifier.height(4.dp))
            }

            if (activeChannelId == null) {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text("Select a channel to start messaging.", style = MaterialTheme.typography.bodyMedium)
                }
            } else {
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(messages, key = { it.clientMsgId }) { message ->
                        MessageBubble(
                            message = message,
                            isMine = message.senderId == viewModel.currentUserId,
                            resolveAttachmentUrl = { key -> viewModel.signAttachmentUrl(key) },
                        )
                    }
                }

                viewModel.attachmentError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                }

                pendingPhoto?.let { uri ->
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        AsyncImage(model = uri, contentDescription = null, modifier = Modifier.size(48.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Photo attached", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        IconButton(onClick = { pendingPhoto = null }) { Icon(Icons.Filled.Close, contentDescription = "Remove photo") }
                    }
                }

                Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { photoPicker.launch("image/*") }) {
                        Icon(Icons.Filled.AttachFile, contentDescription = "Attach a photo")
                    }
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        placeholder = { Text("Message…") },
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            val photo = pendingPhoto
                            if (photo != null) {
                                val mimeType = context.contentResolver.getType(photo) ?: "image/jpeg"
                                viewModel.sendWithPhoto(photo, mimeType, draft)
                                pendingPhoto = null
                            } else {
                                viewModel.send(draft)
                            }
                            draft = ""
                        },
                        enabled = !viewModel.sendingAttachment && (draft.isNotBlank() || pendingPhoto != null),
                    ) { Text(if (viewModel.sendingAttachment) "Sending…" else "Send") }
                }
            }
        }
    }
}

@Composable
private fun CreateRoomDialog(saving: Boolean, error: String?, onDismiss: () -> Unit, onCreate: (name: String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New room") },
        text = {
            Column {
                Text("Open to everyone on the team, now and in the future.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Room name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(name.trim()) }, enabled = !saving && name.isNotBlank()) {
                Text(if (saving) "Creating…" else "Create")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
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
private fun MessageBubble(message: ChatMessageEntity, isMine: Boolean, resolveAttachmentUrl: suspend (String) -> String) {
    var attachmentDisplayUrl by remember(message.attachmentUrl) { mutableStateOf<String?>(null) }
    LaunchedEffect(message.attachmentUrl) {
        message.attachmentUrl?.let { key -> runCatching { resolveAttachmentUrl(key) }.getOrNull()?.let { attachmentDisplayUrl = it } }
    }

    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (isMine) Alignment.End else Alignment.Start) {
        if (!isMine && message.senderFullName != null) {
            Text(
                message.senderFullName,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, bottom = 2.dp),
            )
        }
        Surface(
            color = if (isMine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
            shape = MaterialTheme.shapes.medium,
        ) {
            Column(Modifier.padding(8.dp)) {
                attachmentDisplayUrl?.let { url ->
                    AsyncImage(
                        model = url,
                        contentDescription = "Attachment",
                        modifier = Modifier.size(200.dp).padding(bottom = if (message.body.isNullOrBlank()) 0.dp else 6.dp),
                    )
                }
                if (!message.body.isNullOrBlank()) {
                    Text(
                        message.body,
                        color = if (isMine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

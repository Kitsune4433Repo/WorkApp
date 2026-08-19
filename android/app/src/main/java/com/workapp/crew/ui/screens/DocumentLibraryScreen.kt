package com.workapp.crew.ui.screens

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.local.entities.DocumentEntity
import com.workapp.crew.data.repository.AuthRepository
import com.workapp.crew.data.repository.DocumentRepository
import com.workapp.crew.data.repository.DownloadResult
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

private val UPLOAD_ROLES = setOf("admin", "crew_lead")
private val DOCUMENT_CATEGORIES = listOf("Production", "Property Map")

@HiltViewModel
class DocumentLibraryViewModel @Inject constructor(
    private val repository: DocumentRepository,
    authRepository: AuthRepository,
) : ViewModel() {
    val canUpload = authRepository.currentRole in UPLOAD_ROLES

    val documents = repository.observeAll().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun refresh() = repository.refresh()

    var downloadingId by mutableStateOf<String?>(null)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    var uploading by mutableStateOf(false)
        private set

    fun download(doc: DocumentEntity, onReady: (String) -> Unit) {
        downloadingId = doc.id
        errorMessage = null
        viewModelScope.launch {
            when (val result = repository.ensureCached(doc.id, doc.localFilePath)) {
                is DownloadResult.Cached -> onReady(result.filePath)
                is DownloadResult.Failed -> errorMessage = result.message
            }
            downloadingId = null
        }
    }

    /** Matches web's UploadCenter: docType is derived from the file itself (extension, falling
     * back to the MIME subtype) rather than asked of the user; isMap follows from the category. */
    fun upload(fileUri: Uri, fileName: String, mimeType: String, title: String, category: String, description: String?) {
        uploading = true
        errorMessage = null
        viewModelScope.launch {
            try {
                val docType = fileName.substringAfterLast('.', "").ifBlank { mimeType.substringAfter('/', "file") }.lowercase()
                repository.upload(
                    fileUri = fileUri,
                    fileName = fileName,
                    mimeType = mimeType,
                    title = title,
                    docType = docType,
                    category = category,
                    description = description?.ifBlank { null },
                    isMap = category == "Property Map",
                )
            } catch (e: Exception) {
                errorMessage = "Failed to upload."
            } finally {
                uploading = false
            }
        }
    }
}

/** Resolves a content:// Uri's display name — needed because the picker only hands back an
 * opaque Uri, not a filename, and the upload form needs one for both the title default and the
 * multipart filename. */
private fun queryDisplayName(context: android.content.Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIndex >= 0 && cursor.moveToFirst()) return cursor.getString(nameIndex) ?: "file"
    }
    return "file"
}

/** Feature 6: searchable, offline-capable library of job files, manuals, and property maps. */
@Composable
fun DocumentLibraryScreen(viewModel: DocumentLibraryViewModel = hiltViewModel(), onOpenMap: (String) -> Unit) {
    val context = LocalContext.current
    val documents by viewModel.documents.collectAsState()
    PeriodicRefresh { viewModel.refresh() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Document & Map Library", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text("Cached documents stay available with zero signal.", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))

        if (viewModel.canUpload) {
            UploadForm(
                uploading = viewModel.uploading,
                onUpload = { uri, fileName, mimeType, title, category, description ->
                    viewModel.upload(uri, fileName, mimeType, title, category, description)
                },
            )
            Spacer(Modifier.height(12.dp))
        }

        viewModel.errorMessage?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp))
        }

        if (documents.isEmpty()) {
            Text("No documents available yet.", style = MaterialTheme.typography.bodyMedium)
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(documents, key = { it.id }) { doc ->
                DocumentRow(
                    doc = doc,
                    isDownloading = viewModel.downloadingId == doc.id,
                    onOpen = {
                        viewModel.download(doc) { filePath ->
                            if (doc.isMap) {
                                onOpenMap(doc.id)
                            } else {
                                openWithSystemViewer(context, filePath, doc.docType)
                            }
                        }
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun UploadForm(
    uploading: Boolean,
    onUpload: (uri: Uri, fileName: String, mimeType: String, title: String, category: String, description: String?) -> Unit,
) {
    val context = LocalContext.current
    var expanded by remember { mutableStateOf(false) }
    var pickedUri by remember { mutableStateOf<Uri?>(null) }
    var pickedName by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(DOCUMENT_CATEGORIES[0]) }
    var categoryMenuExpanded by remember { mutableStateOf(false) }
    var description by remember { mutableStateOf("") }

    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            pickedUri = uri
            pickedName = queryDisplayName(context, uri)
            if (title.isBlank()) title = pickedName.substringBeforeLast('.')
        }
    }

    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Upload a resource", style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Cancel" else "Upload") }
            }
            if (expanded) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { pickFile.launch("*/*") }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.CloudUpload, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(pickedName.ifBlank { "Choose a file" })
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                ExposedDropdownMenuBox(expanded = categoryMenuExpanded, onExpandedChange = { categoryMenuExpanded = it }) {
                    OutlinedTextField(
                        value = category,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Category") },
                        modifier = Modifier.menuAnchor().fillMaxWidth(),
                    )
                    ExposedDropdownMenu(expanded = categoryMenuExpanded, onDismissRequest = { categoryMenuExpanded = false }) {
                        DOCUMENT_CATEGORIES.forEach { c ->
                            DropdownMenuItem(text = { Text(c) }, onClick = { category = c; categoryMenuExpanded = false })
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = {
                        val uri = pickedUri ?: return@Button
                        val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
                        onUpload(uri, pickedName, mimeType, title.trim(), category, description.trim())
                        pickedUri = null; pickedName = ""; title = ""; description = ""; expanded = false
                    },
                    enabled = !uploading && pickedUri != null && title.isNotBlank(),
                    modifier = Modifier.align(Alignment.End),
                ) { Text(if (uploading) "Uploading…" else "Save") }
            }
        }
    }
}

@Composable
private fun DocumentRow(doc: DocumentEntity, isDownloading: Boolean, onOpen: () -> Unit) {
    val isCached = doc.localFilePath != null && File(doc.localFilePath).exists()

    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (doc.isMap) Icons.Filled.Map else Icons.Filled.Description, contentDescription = null)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(doc.title, style = MaterialTheme.typography.titleMedium)
                    Text(
                        listOfNotNull(doc.docType.uppercase(), doc.category, "v${doc.currentVersion}").joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            when {
                isDownloading -> CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                isCached -> IconButton(onClick = onOpen) { Icon(Icons.Filled.CheckCircle, contentDescription = "Open (cached offline)") }
                else -> IconButton(onClick = onOpen) { Icon(Icons.Filled.CloudDownload, contentDescription = "Download for offline use") }
            }
        }
    }
}

private fun openWithSystemViewer(context: android.content.Context, filePath: String, docType: String) {
    val file = File(filePath)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val mimeType = when (docType) {
        "pdf" -> "application/pdf"
        "png" -> "image/png"
        "jpg" -> "image/jpeg"
        else -> "*/*"
    }
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { context.startActivity(intent) }
}

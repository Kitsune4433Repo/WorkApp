package com.workapp.crew.ui.screens

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.local.entities.DocumentEntity
import com.workapp.crew.data.repository.DocumentRepository
import com.workapp.crew.data.repository.DownloadResult
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

@HiltViewModel
class DocumentLibraryViewModel @Inject constructor(private val repository: DocumentRepository) : ViewModel() {
    val documents = repository.observeAll().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun refresh() = repository.refresh()

    var downloadingId by mutableStateOf<String?>(null)
        private set
    var errorMessage by mutableStateOf<String?>(null)
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

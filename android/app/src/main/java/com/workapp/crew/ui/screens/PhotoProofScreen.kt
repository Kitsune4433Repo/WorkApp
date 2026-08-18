package com.workapp.crew.ui.screens

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.compose.AsyncImage
import com.workapp.crew.data.local.dao.DocumentDao
import com.workapp.crew.data.local.entities.PhotoProofEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import id.zelory.compressor.Compressor
import id.zelory.compressor.constraint.quality
import id.zelory.compressor.constraint.resolution
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class PhotoProofViewModel @Inject constructor(private val documentDao: DocumentDao) : ViewModel() {

    fun photosForJob(jobId: String) = documentDao.observePhotosForJob(jobId).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** Feature 13: compress on-device before queuing for upload, so a 12MP field photo doesn't
     * stall the sync queue on a weak site connection. */
    fun attachPhoto(context: Context, jobId: String, rawFile: File, lat: Double?, lng: Double?) = viewModelScope.launch {
        val compressed = Compressor.compress(context, rawFile) {
            resolution(1920, 1920)
            quality(78)
        }
        documentDao.insertPhotoProof(
            PhotoProofEntity(
                clientPhotoId = UUID.randomUUID().toString(),
                jobId = jobId,
                localFilePath = compressed.absolutePath,
                takenAt = System.currentTimeMillis(),
                lat = lat,
                lng = lng,
            ),
        )
        rawFile.delete() // the compressed copy is what gets kept/uploaded; drop the full-res original
    }
}

private fun createCaptureFile(context: Context): Pair<File, Uri> {
    val dir = File(context.cacheDir, "photo_captures").apply { mkdirs() }
    val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    return file to uri
}

/** Feature 13: closeout photo proof attached to a completed job ticket. */
@Composable
fun PhotoProofScreen(jobId: String, viewModel: PhotoProofViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val photos by viewModel.photosForJob(jobId).collectAsState()

    var pendingCapture by remember { mutableStateOf<Pair<File, Uri>?>(null) }

    val captureLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val capture = pendingCapture
        pendingCapture = null
        if (success && capture != null) {
            viewModel.attachPhoto(context, jobId, capture.first, lat = null, lng = null)
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Column {
                Text("Photo Proof", style = MaterialTheme.typography.headlineSmall)
                Text("${photos.size} photo(s) attached · pending upload shown until synced", style = MaterialTheme.typography.bodySmall)
            }
            FilledIconButton(onClick = {
                val capture = createCaptureFile(context)
                pendingCapture = capture
                captureLauncher.launch(capture.second)
            }) {
                Icon(Icons.Filled.CameraAlt, contentDescription = "Take photo")
            }
        }
        Spacer(Modifier.height(12.dp))

        LazyVerticalGrid(columns = GridCells.Fixed(3), verticalArrangement = Arrangement.spacedBy(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            items(photos, key = { it.clientPhotoId }) { photo ->
                PhotoThumbnail(photo)
            }
        }
    }
}

@Composable
private fun PhotoThumbnail(photo: PhotoProofEntity) {
    Card(Modifier.aspectRatio(1f)) {
        Box {
            AsyncImage(
                model = File(photo.localFilePath),
                contentDescription = "Job photo",
                modifier = Modifier.fillMaxSize(),
            )
            if (!photo.synced) {
                Surface(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
                    modifier = Modifier.align(androidx.compose.ui.Alignment.BottomCenter).fillMaxWidth(),
                ) {
                    Text(
                        "Pending upload",
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(2.dp),
                    )
                }
            }
        }
    }
}

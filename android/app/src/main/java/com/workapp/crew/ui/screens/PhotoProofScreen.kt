package com.workapp.crew.ui.screens

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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
    }
}

/** Feature 13: closeout photo proof attached to a completed job ticket. */
@Composable
fun PhotoProofScreen(jobId: String, viewModel: PhotoProofViewModel = hiltViewModel()) {
    val photos by viewModel.photosForJob(jobId).collectAsState()

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Photo Proof", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text("${photos.size} photo(s) attached · pending upload shown until synced", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))

        LazyVerticalGrid(columns = GridCells.Fixed(3), verticalArrangement = Arrangement.spacedBy(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            items(photos, key = { it.clientPhotoId }) { photo ->
                Card(Modifier.aspectRatio(1f)) {
                    // AsyncImage(model = photo.localFilePath, ...) renders the thumbnail here in
                    // the full implementation; omitted to keep this scaffold dependency-minimal.
                }
            }
        }

        // The camera capture button launches ActivityResultContracts.TakePicture(), writes the
        // full-resolution JPEG to a cache file, then calls viewModel.attachPhoto(...) with it.
    }
}

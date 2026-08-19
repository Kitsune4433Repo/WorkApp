package com.workapp.crew.data.repository

import android.content.Context
import com.workapp.crew.data.local.dao.DocumentDao
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.di.RawHttpClient
import com.workapp.crew.sync.SyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

sealed class DownloadResult {
    data class Cached(val filePath: String) : DownloadResult()
    data class Failed(val message: String) : DownloadResult()
}

/** Feature 6: offline-capable document/map library. Documents themselves sync as metadata via
 * SyncWorker.pullDocuments(); the (often large) file body is fetched on demand here, the first
 * time a technician opens it, and cached to disk so every later open works with zero signal. */
@Singleton
class DocumentRepository @Inject constructor(
    private val dao: DocumentDao,
    private val api: ApiService,
    @RawHttpClient private val rawHttpClient: OkHttpClient,
    @ApplicationContext private val context: Context,
) {
    fun observeAll() = dao.observeAll()
    fun observeMaps() = dao.observeMaps()

    /** Pulls fresh document/map metadata (see SyncWorker.pullDocuments) — the local Room cache
     * otherwise only updates on the 15-minute background schedule, or after some unrelated write
     * elsewhere happens to trigger a sync. */
    fun refresh() = SyncWorker.triggerImmediateSync(context)

    suspend fun ensureCached(documentId: String, existingLocalPath: String?): DownloadResult {
        if (existingLocalPath != null && File(existingLocalPath).exists()) {
            return DownloadResult.Cached(existingLocalPath)
        }
        return withContext(Dispatchers.IO) {
            try {
                val signedUrl = api.getDocumentDownloadUrl(documentId).url
                val request = Request.Builder().url(signedUrl).build()
                rawHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        return@withContext DownloadResult.Failed("Download failed (${response.code})")
                    }
                    val bytes = response.body?.bytes() ?: return@withContext DownloadResult.Failed("Empty response")
                    val dir = File(context.filesDir, "documents").apply { mkdirs() }
                    val file = File(dir, documentId)
                    file.writeBytes(bytes)
                    dao.setLocalFilePath(documentId, file.absolutePath)
                    DownloadResult.Cached(file.absolutePath)
                }
            } catch (e: IOException) {
                DownloadResult.Failed("Can't reach the server. Check your connection.")
            } catch (e: retrofit2.HttpException) {
                DownloadResult.Failed("Download failed (${e.code()})")
            }
        }
    }
}

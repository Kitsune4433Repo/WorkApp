package com.workapp.crew.data.repository

import android.content.Context
import android.net.Uri
import com.workapp.crew.data.local.dao.DocumentDao
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.DocumentUploadResponse
import com.workapp.crew.di.RawHttpClient
import com.workapp.crew.sync.SyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
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

    /** Admin/crew_lead only (enforced server-side) — matches web's UploadCenter. The picked file
     * comes back as a content:// Uri, not a path, so it's copied to a cache file first (streamed,
     * not read fully into memory — resource files can be sizeable) to get something OkHttp's
     * MultipartBody can stream from. */
    suspend fun upload(
        fileUri: Uri,
        fileName: String,
        mimeType: String,
        title: String,
        docType: String,
        category: String,
        description: String?,
        isMap: Boolean,
    ): DocumentUploadResponse = withContext(Dispatchers.IO) {
        val tempFile = File(context.cacheDir, "upload_${System.currentTimeMillis()}_$fileName")
        try {
            context.contentResolver.openInputStream(fileUri)?.use { input ->
                tempFile.outputStream().use { output -> input.copyTo(output) }
            } ?: throw IOException("Can't read the selected file")

            val response = api.uploadDocument(
                file = MultipartBody.Part.createFormData("file", fileName, tempFile.asRequestBody(mimeType.toMediaType())),
                title = title.toRequestBody("text/plain".toMediaType()),
                docType = docType.toRequestBody("text/plain".toMediaType()),
                category = category.toRequestBody("text/plain".toMediaType()),
                description = description?.toRequestBody("text/plain".toMediaType()),
                isMap = isMap.toString().toRequestBody("text/plain".toMediaType()),
            )
            refresh()
            response
        } finally {
            tempFile.delete()
        }
    }

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

package com.workapp.crew.data.remote

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.*

// DTOs are deliberately flat/JSON-shaped (Moshi) to mirror the backend's REST payloads exactly;
// mapping into Room entities happens once, in the repository layer.

data class LoginRequest(val email: String, val password: String)
data class AuthTokens(val access: String, val refresh: String, val user: UserDto? = null)
data class UserDto(val id: String, val email: String, val role: String, val fullName: String, val hourlyRateCents: Int)
data class RefreshRequest(val refreshToken: String)

data class LatLngDto(val lat: Double, val lng: Double)
data class JobDto(
    val id: String, val job_number: String, val title: String, val status: String,
    val priority: String, val lat: Double, val lng: Double,
    val scheduled_start: String?, val scheduled_end: String?, val crew_id: String?,
)

data class HaveRowDto(val material_id: String, val sku: String, val name: String, val unit: String, val quantity_have: Double, val version: Long)
data class AdjustInventoryRequest(val materialId: String, val delta: Double, val jobId: String?, val clientTxnId: String, val occurredAt: String)
data class AdjustInventoryResponse(val materialId: String, val quantityHave: Double)

data class QrTransferCreateRequest(val materialId: String, val quantity: Double, val ttlSeconds: Int)
data class QrTransferCreateResponse(val transferId: String, val qrToken: String, val expiresAt: String)
data class QrTransferClaimResponse(val materialId: String, val quantity: Double, val fromUserId: String)

data class ClockInRequest(val jobId: String?, val location: LatLngDto, val deviceTime: String, val clientEventId: String, val signature: String?)
data class ClockInResponse(val id: String, val clockInAt: String, val inGeofence: Boolean?, val tamperFlag: Boolean)
data class ClockOutRequest(val location: LatLngDto, val deviceTime: String, val signature: String?)
data class ClockOutResponse(val id: String, val totalMinutes: Int, val earningsCents: Int, val inGeofence: Boolean?)
data class ActiveTimecardDto(
    val id: String, val job_id: String?, val clock_in_at: String, val onBreak: Boolean,
    val liveActiveMinutes: Int, val liveEarningsCents: Int,
)
data class LocationPingBatchRequest(val points: List<LocationPingPointDto>, val jobId: String?)
data class LocationPingPointDto(val location: LatLngDto, val recordedAt: String, val accuracyM: Float?, val batteryPct: Int?)

// Pull-sync response shapes are per-entity (not a shared generic) so Moshi can decode them without
// runtime type erasure gymnastics — see SyncWorker.pullJobs/pullMaterials.
data class JobPullDto(
    val id: String, val job_number: String, val title: String, val description: String?,
    val status: String, val priority: String, val lat: Double, val lng: Double,
    val geofence_radius_m: Int?, val geofence_points: List<LatLngDto>?,
    val scheduled_start: String?, val scheduled_end: String?, val updated_at: String,
)
data class JobsPullResponse(val entityType: String, val since: String, val records: List<JobPullDto>, val syncedAt: String)

data class MaterialPullDto(val id: String, val sku: String, val name: String, val category: String, val unit: String, val updated_at: String)
data class MaterialsPullResponse(val entityType: String, val since: String, val records: List<MaterialPullDto>, val syncedAt: String)

data class DocumentPullDto(
    val id: String, val title: String, val doc_type: String, val category: String?,
    val job_id: String?, val current_version: Int, val is_map: Boolean, val updated_at: String,
)
data class DocumentsPullResponse(val entityType: String, val since: String, val records: List<DocumentPullDto>, val syncedAt: String)

data class DocumentDownloadUrlResponse(val url: String)

data class ChatChannelDto(val id: String, val type: String, val name: String?, val job_id: String?)
data class CreateChannelRequest(val type: String, val name: String?, val jobId: String?, val memberUserIds: List<String>)
data class CreateChannelResponse(val id: String)
data class ChatMessageRemoteDto(
    val id: String, val sender_id: String, val body: String?, val attachment_url: String?, val sent_at: String,
)

interface ApiService {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): AuthTokens

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): AuthTokens

    @GET("jobs")
    suspend fun getJobs(): List<JobDto>

    @GET("inventory/have/{userId}")
    suspend fun getHaveLedger(@Path("userId") userId: String): List<HaveRowDto>

    @POST("inventory/have/adjust")
    suspend fun adjustInventory(@Body body: AdjustInventoryRequest): AdjustInventoryResponse

    @POST("inventory/qr-transfer")
    suspend fun createQrTransfer(@Body body: QrTransferCreateRequest): QrTransferCreateResponse

    @POST("inventory/qr-transfer/{token}/claim")
    suspend fun claimQrTransfer(@Path("token") token: String): QrTransferClaimResponse

    @POST("timecards/clock-in")
    suspend fun clockIn(@Body body: ClockInRequest): ClockInResponse

    @POST("timecards/clock-out")
    suspend fun clockOut(@Body body: ClockOutRequest): ClockOutResponse

    @GET("timecards/active")
    suspend fun getActiveTimecard(): ActiveTimecardDto?

    @POST("timecards/location-pings")
    suspend fun postLocationPings(@Body body: LocationPingBatchRequest)

    @Multipart
    @POST("photo-proofs")
    suspend fun uploadPhotoProof(
        @Part photo: MultipartBody.Part,
        @Part("jobId") jobId: RequestBody,
        @Part("takenAt") takenAt: RequestBody,
        @Part("clientPhotoId") clientPhotoId: RequestBody,
    )

    @PUT("documents/{documentId}/annotations")
    suspend fun putAnnotations(@Path("documentId") documentId: String, @Body body: Map<String, @JvmSuppressWildcards Any>)

    @GET("sync/pull/jobs")
    suspend fun pullJobs(): JobsPullResponse

    @GET("sync/pull/material_catalog")
    suspend fun pullMaterials(): MaterialsPullResponse

    @GET("sync/pull/documents")
    suspend fun pullDocuments(): DocumentsPullResponse

    @GET("documents/{documentId}/download")
    suspend fun getDocumentDownloadUrl(@Path("documentId") documentId: String): DocumentDownloadUrlResponse

    @GET("chat/channels")
    suspend fun getChatChannels(): List<ChatChannelDto>

    @POST("chat/channels")
    suspend fun createChatChannel(@Body body: CreateChannelRequest): CreateChannelResponse

    @GET("chat/channels/{channelId}/messages")
    suspend fun getChatMessages(@Path("channelId") channelId: String, @Query("before") before: String? = null): List<ChatMessageRemoteDto>
}

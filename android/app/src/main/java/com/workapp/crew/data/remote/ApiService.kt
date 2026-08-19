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

// quantity_have (NUMERIC) and version (BIGINT) are serialized as JSON strings by the backend —
// same pattern as RestockItemDto.quantity_needed below; parsed at the point of use in
// SyncWorker.pullHaveLedger().
data class CreateMaterialRequest(val name: String, val category: String, val unit: String, val description: String? = null)
data class CreateMaterialResponse(val id: String)

data class HaveRowDto(val material_id: String, val sku: String, val name: String, val unit: String, val quantity_have: String, val version: String)
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
data class DocumentUploadResponse(val id: String)

data class RegisterDeviceRequest(val deviceId: String, val pushToken: String, val platform: String)

data class ChatChannelDto(val id: String, val type: String, val name: String?, val job_id: String?)
data class CreateChannelRequest(val type: String, val name: String?, val jobId: String?, val memberUserIds: List<String>)
data class CreateChannelResponse(val id: String)
data class ChatMessageRemoteDto(
    val id: String, val sender_id: String, val body: String?, val attachment_url: String?, val sent_at: String,
)

// --- Out Of Inventory (restock requests) -------------------------------------
// quantity_needed is NUMERIC on the backend, which Postgres/node-pg serializes as a JSON string —
// declared String here and parsed at the point of use, same pattern as the web app's Number(...)
// coercion fix for the same column.
data class RestockItemDto(
    val id: String, val material_id: String?, val item_name: String, val unit: String,
    val quantity_needed: String, val note: String?, val requested_by: String?, val created_at: String,
)
data class CreateRestockRequest(val itemName: String, val unit: String, val quantityNeeded: Double, val note: String?)
data class CreateRestockResponse(val id: String)
data class UpdateRestockRequest(val quantityNeeded: Double? = null, val note: String? = null)
data class FulfillRestockResponse(val materialId: String, val quantityHave: Double)

// --- Payroll -------------------------------------------------------------------
// earnings_cents / total_wage_cents are BIGINT on the backend — same string-serialization issue as
// above. total_minutes / days_worked are INTEGER and arrive as real JSON numbers.
data class PersonPeriodTotalsDto(
    val user_id: String?, val full_name: String?, val user_full_name_snapshot: String?,
    val days_worked: Int, val total_minutes: Int, val earnings_cents: String,
)
data class YmdDto(val year: Int, val month: Int, val day: Int)
data class WeeklySummaryDto(
    val periodStart: YmdDto, val periodEnd: YmdDto, val label: String,
    val people: List<PersonPeriodTotalsDto>, val totalWageCents: Long,
)
data class PayrollPeriodDto(
    val id: String, val period_start: String, val period_end: String, val label: String,
    val total_wage_cents: String, val finalized_at: String,
)
data class PayrollPeriodDetailDto(
    val id: String, val period_start: String, val period_end: String, val label: String,
    val total_wage_cents: String, val finalized_at: String, val people: List<PersonPeriodTotalsDto>,
)

// --- Sync conflicts --------------------------------------------------------------
data class SyncConflictDto(
    val id: String, val entity_type: String, val entity_id: String, val device_id: String,
    val user_id: String?, val client_payload: Any?, val server_payload: Any?,
    val client_version: String, val server_version: String, val created_at: String,
)
data class ResolveConflictRequest(val resolution: String, val resolvedPayload: Any? = null)

// --- Users (admin) --------------------------------------------------------------
data class UserListItemDto(
    val id: String, val email: String, val full_name: String, val role: String,
    val phone: String?, val hourly_rate_cents: Int, val is_active: Boolean,
)
data class CreateUserRequest(val email: String, val password: String, val fullName: String, val role: String, val hourlyRateCents: Int)
data class CreateUserResponse(val id: String, val email: String)
data class SetUserActiveRequest(val isActive: Boolean)

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

    @POST("inventory/catalog")
    suspend fun createMaterial(@Body body: CreateMaterialRequest): CreateMaterialResponse

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

    @Multipart
    @POST("documents")
    suspend fun uploadDocument(
        @Part file: MultipartBody.Part,
        @Part("title") title: RequestBody,
        @Part("docType") docType: RequestBody,
        @Part("category") category: RequestBody,
        @Part("description") description: RequestBody?,
        @Part("isMap") isMap: RequestBody,
    ): DocumentUploadResponse

    @POST("users/devices")
    suspend fun registerDevice(@Body body: RegisterDeviceRequest)

    @GET("chat/channels")
    suspend fun getChatChannels(): List<ChatChannelDto>

    @POST("chat/channels")
    suspend fun createChatChannel(@Body body: CreateChannelRequest): CreateChannelResponse

    @GET("chat/channels/{channelId}/messages")
    suspend fun getChatMessages(@Path("channelId") channelId: String, @Query("before") before: String? = null): List<ChatMessageRemoteDto>

    @POST("jobs/{jobId}/start")
    suspend fun startJob(@Path("jobId") jobId: String)

    @POST("jobs/{jobId}/stop")
    suspend fun stopJob(@Path("jobId") jobId: String)

    @GET("inventory/restock")
    suspend fun getRestockRequests(): List<RestockItemDto>

    @POST("inventory/restock")
    suspend fun createRestockRequest(@Body body: CreateRestockRequest): CreateRestockResponse

    @PATCH("inventory/restock/{id}")
    suspend fun updateRestockRequest(@Path("id") id: String, @Body body: UpdateRestockRequest)

    @DELETE("inventory/restock/{id}")
    suspend fun deleteRestockRequest(@Path("id") id: String)

    @POST("inventory/restock/{id}/fulfill")
    suspend fun fulfillRestockRequest(@Path("id") id: String): FulfillRestockResponse

    @GET("timecards/weekly-summary")
    suspend fun getWeeklySummary(): WeeklySummaryDto

    @GET("timecards/payroll-periods")
    suspend fun getPayrollPeriods(): List<PayrollPeriodDto>

    @GET("timecards/payroll-periods/{id}")
    suspend fun getPayrollPeriodDetail(@Path("id") id: String): PayrollPeriodDetailDto

    @GET("sync/conflicts")
    suspend fun getConflicts(): List<SyncConflictDto>

    @POST("sync/conflicts/{id}/resolve")
    suspend fun resolveConflict(@Path("id") id: String, @Body body: ResolveConflictRequest)

    @GET("users")
    suspend fun getUsers(): List<UserListItemDto>

    @POST("users")
    suspend fun createUser(@Body body: CreateUserRequest): CreateUserResponse

    @PATCH("users/{id}")
    suspend fun setUserActive(@Path("id") id: String, @Body body: SetUserActiveRequest)

    @DELETE("users/{id}")
    suspend fun deleteUser(@Path("id") id: String)
}

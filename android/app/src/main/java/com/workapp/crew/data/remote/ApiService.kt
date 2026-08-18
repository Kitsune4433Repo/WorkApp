package com.workapp.crew.data.remote

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.*

// DTOs are deliberately flat/JSON-shaped (Moshi) to mirror the backend's REST payloads exactly;
// mapping into Room entities happens once, in the repository layer.

data class LoginRequest(val email: String, val password: String)
data class AuthTokens(val access: String, val refresh: String, val user: UserDto)
data class UserDto(val id: String, val email: String, val role: String, val fullName: String)
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

data class SyncPullResponse<T>(val entityType: String, val since: String, val records: List<T>, val syncedAt: String)

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

    @GET("sync/pull/{entityType}")
    suspend fun pull(@Path("entityType") entityType: String): SyncPullResponse<Map<String, @JvmSuppressWildcards Any>>
}

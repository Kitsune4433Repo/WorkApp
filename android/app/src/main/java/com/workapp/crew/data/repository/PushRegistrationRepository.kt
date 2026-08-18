package com.workapp.crew.data.repository

import com.google.firebase.messaging.FirebaseMessaging
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.AuthTokenStore
import com.workapp.crew.data.remote.RegisterDeviceRequest
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.inject.Inject
import javax.inject.Singleton

/** Feature 10: registers this device's FCM token against the logged-in user so dispatch/chat
 * pushes can actually be delivered. Called both right after login (the token from a previous
 * install/user may already be current and FCM won't re-fire onNewToken for it) and whenever FCM
 * rotates the token (CrewFirebaseMessagingService.onNewToken). */
@Singleton
class PushRegistrationRepository @Inject constructor(
    private val api: ApiService,
    private val tokenStore: AuthTokenStore,
) {
    suspend fun registerCurrentToken() {
        if (tokenStore.accessToken == null) return
        val token = getCurrentFcmToken() ?: return
        registerToken(token)
    }

    suspend fun registerToken(pushToken: String) {
        if (tokenStore.accessToken == null) return
        runCatching {
            api.registerDevice(RegisterDeviceRequest(deviceId = tokenStore.deviceId, pushToken = pushToken, platform = "android"))
        }
        // Best-effort: a failed registration just means this device stays on FCM push until the
        // next successful attempt (next login, next token rotation, or next app foreground retry
        // a fuller implementation would add). It never blocks the user from doing anything.
    }

    private suspend fun getCurrentFcmToken(): String? = suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token -> if (cont.isActive) cont.resumeWith(Result.success(token)) }
            .addOnFailureListener { if (cont.isActive) cont.resumeWith(Result.success(null)) }
    }
}

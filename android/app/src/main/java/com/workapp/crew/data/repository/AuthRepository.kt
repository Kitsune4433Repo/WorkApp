package com.workapp.crew.data.repository

import android.content.Context
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.AuthTokenStore
import com.workapp.crew.data.remote.LoginRequest
import com.workapp.crew.sync.SyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

sealed class LoginResult {
    data object Success : LoginResult()
    data class Failure(val message: String) : LoginResult()
}

@Singleton
class AuthRepository @Inject constructor(
    private val api: ApiService,
    private val tokenStore: AuthTokenStore,
    private val pushRegistrationRepository: PushRegistrationRepository,
    @ApplicationContext private val context: Context,
) {
    val isLoggedIn: StateFlow<Boolean> = tokenStore.isLoggedIn

    val currentUserId: String? get() = tokenStore.userId
    val currentFullName: String? get() = tokenStore.fullName
    val currentRole: String? get() = tokenStore.role
    val currentHourlyRateCents: Int get() = tokenStore.hourlyRateCents

    suspend fun login(email: String, password: String): LoginResult = try {
        val tokens = api.login(LoginRequest(email, password))
        tokenStore.saveSession(tokens)
        // Best-effort — a fresh install's FCM token is usually already available by login time,
        // and onNewToken alone wouldn't cover "same device, different user logs in".
        pushRegistrationRepository.registerCurrentToken()
        // Without this, Room-backed screens (Job Board, Inventory, Documents) sit empty until the
        // 15-minute periodic worker happens to fire or an unrelated write triggers one — jarring
        // right after a fresh login/install.
        SyncWorker.triggerImmediateSync(context)
        LoginResult.Success
    } catch (e: retrofit2.HttpException) {
        val message = if (e.code() == 401) "Incorrect email or password." else "Sign-in failed (${e.code()}). Try again."
        LoginResult.Failure(message)
    } catch (e: java.io.IOException) {
        LoginResult.Failure("Can't reach the server. Check your connection.")
    }

    fun logout() {
        tokenStore.clear()
    }
}

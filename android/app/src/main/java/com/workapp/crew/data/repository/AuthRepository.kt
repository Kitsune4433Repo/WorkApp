package com.workapp.crew.data.repository

import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.AuthTokenStore
import com.workapp.crew.data.remote.LoginRequest
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
) {
    val isLoggedIn: StateFlow<Boolean> = tokenStore.isLoggedIn

    val currentUserId: String? get() = tokenStore.userId
    val currentFullName: String? get() = tokenStore.fullName
    val currentRole: String? get() = tokenStore.role
    val currentHourlyRateCents: Int get() = tokenStore.hourlyRateCents

    suspend fun login(email: String, password: String): LoginResult = try {
        val tokens = api.login(LoginRequest(email, password))
        tokenStore.saveSession(tokens)
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

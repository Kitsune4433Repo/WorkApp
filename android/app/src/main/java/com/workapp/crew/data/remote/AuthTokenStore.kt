package com.workapp.crew.data.remote

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthTokenStore @Inject constructor(@ApplicationContext context: Context) {
    private val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "auth_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val _isLoggedIn = MutableStateFlow(prefs.getString("access_token", null) != null)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    var accessToken: String?
        get() = prefs.getString("access_token", null)
        set(value) {
            prefs.edit().putString("access_token", value).apply()
            _isLoggedIn.value = value != null
        }

    var refreshToken: String?
        get() = prefs.getString("refresh_token", null)
        set(value) = prefs.edit().putString("refresh_token", value).apply()

    var userId: String?
        get() = prefs.getString("user_id", null)
        set(value) = prefs.edit().putString("user_id", value).apply()

    var fullName: String?
        get() = prefs.getString("full_name", null)
        set(value) = prefs.edit().putString("full_name", value).apply()

    var role: String?
        get() = prefs.getString("role", null)
        set(value) = prefs.edit().putString("role", value).apply()

    var hourlyRateCents: Int
        get() = prefs.getInt("hourly_rate_cents", 0)
        set(value) = prefs.edit().putInt("hourly_rate_cents", value).apply()

    var deviceId: String
        get() = prefs.getString("device_id", null) ?: java.util.UUID.randomUUID().toString().also { deviceId = it }
        set(value) = prefs.edit().putString("device_id", value).apply()

    fun saveSession(tokens: AuthTokens) {
        accessToken = tokens.access
        refreshToken = tokens.refresh
        tokens.user?.let { user ->
            userId = user.id
            fullName = user.fullName
            role = user.role
            hourlyRateCents = user.hourlyRateCents
        }
    }

    fun clear() {
        prefs.edit().clear().apply()
        _isLoggedIn.value = false
    }
}

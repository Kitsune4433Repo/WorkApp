package com.workapp.crew.data.remote

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import javax.inject.Inject

class AuthInterceptor @Inject constructor(private val tokenStore: AuthTokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val builder = original.newBuilder().addHeader("X-Device-Id", tokenStore.deviceId)
        tokenStore.accessToken?.let { builder.addHeader("Authorization", "Bearer $it") }

        var response = chain.proceed(builder.build())
        if (response.code == 401 && tokenStore.refreshToken != null) {
            response.close()
            synchronized(this) {
                // Another thread may have already refreshed while we waited on the lock.
                val refreshed = refreshTokenBlocking(chain)
                if (refreshed != null) {
                    tokenStore.accessToken = refreshed
                    val retried = original.newBuilder()
                        .addHeader("X-Device-Id", tokenStore.deviceId)
                        .addHeader("Authorization", "Bearer $refreshed")
                        .build()
                    response = chain.proceed(retried)
                }
            }
        }
        return response
    }

    private fun refreshTokenBlocking(chain: Interceptor.Chain): String? {
        val refreshToken = tokenStore.refreshToken ?: return null
        val request = okhttp3.Request.Builder()
            .url(chain.request().url.newBuilder().encodedPath("/api/auth/refresh").build())
            .post("""{"refreshToken":"$refreshToken"}""".toRequestBody("application/json".toMediaType()))
            .build()
        return try {
            chain.proceed(request).use { resp ->
                if (!resp.isSuccessful) return null
                val body = resp.body?.string() ?: return null
                Regex("\"access\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.get(1)
            }
        } catch (e: Exception) {
            null
        }
    }
}

package com.workapp.crew.di

import javax.inject.Qualifier

/** OkHttpClient with no auth/device-id interceptor — for fetching pre-signed object-storage URLs
 * (documents, photos), which carry their own auth in the query string and aren't our API host. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class RawHttpClient

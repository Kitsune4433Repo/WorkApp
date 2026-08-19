package com.workapp.crew.ui.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

/**
 * Cross-device sync freshness for screens with no live socket (chat already has that via
 * Socket.IO and doesn't need this): refreshes as soon as the screen becomes visible/resumed —
 * including coming back from the background, not just first composition — then keeps polling
 * every [intervalMillis] while resumed, so a change made on the website or another phone shows up
 * without a manual app restart. repeatOnLifecycle pauses the loop automatically while backgrounded
 * or off-screen, so there's no separate pause/resume wiring to get wrong per-screen.
 */
@Composable
fun PeriodicRefresh(intervalMillis: Long = 30_000L, onRefresh: () -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                onRefresh()
                delay(intervalMillis)
            }
        }
    }
}

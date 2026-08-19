package com.workapp.crew.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val SoftFocusColorScheme = lightColorScheme(
    primary = SoftFocusPrimary,
    onPrimary = Color.White,
    primaryContainer = SoftFocusPrimaryContainer,
    onPrimaryContainer = SoftFocusOnPrimaryContainer,
    secondary = SoftFocusPrimaryDeep,
    background = SoftFocusBackground,
    onBackground = SoftFocusInk,
    surface = SoftFocusSurface,
    onSurface = SoftFocusInk,
    surfaceVariant = SoftFocusSurfaceVariant,
    onSurfaceVariant = SoftFocusInkMuted,
    outline = SoftFocusOutline,
)

/** Soft Focus — the muted-plum, pale-lavender identity picked from the web Style Lab mockups.
 * Wraps MaterialTheme with that color scheme so the Android app and the web portal read as the
 * same product; screens should use this instead of a bare MaterialTheme { }. */
@Composable
fun CrewHubTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SoftFocusColorScheme,
        content = content,
    )
}

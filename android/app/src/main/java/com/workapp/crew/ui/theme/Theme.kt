package com.workapp.crew.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

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

// Matches the web app's --radius (12px) / --radius-sm (8px) tokens.
private val SoftFocusShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

/** Soft Focus — the muted-plum, pale-lavender identity picked from the web Style Lab mockups.
 * Wraps MaterialTheme with that color scheme, typography (Fraunces headings / Figtree body, same
 * pairing as the web app), and corner radii so the Android app and the web portal read as the
 * same product; screens should use this instead of a bare MaterialTheme { }. */
@Composable
fun CrewHubTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SoftFocusColorScheme,
        typography = SoftFocusTypography,
        shapes = SoftFocusShapes,
        content = content,
    )
}

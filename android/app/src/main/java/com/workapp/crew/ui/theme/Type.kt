package com.workapp.crew.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.workapp.crew.R

// Same pairing as the web app (web/index.html + tailwind.config.js): Fraunces for headings,
// Figtree for body text — bundled as static font files rather than fetched at runtime, since that
// doesn't depend on Google Play Services being present on the device.

val FraunecesFontFamily = FontFamily(
    Font(R.font.fraunces_medium, FontWeight.Medium),
    Font(R.font.fraunces_semibold, FontWeight.SemiBold),
    Font(R.font.fraunces_bold, FontWeight.Bold),
)

val FigtreeFontFamily = FontFamily(
    Font(R.font.figtree_regular, FontWeight.Normal),
    Font(R.font.figtree_medium, FontWeight.Medium),
    Font(R.font.figtree_semibold, FontWeight.SemiBold),
    Font(R.font.figtree_bold, FontWeight.Bold),
)

private val defaultTypography = Typography()

val SoftFocusTypography = Typography(
    displayLarge = defaultTypography.displayLarge.copy(fontFamily = FraunecesFontFamily, fontWeight = FontWeight.SemiBold),
    displayMedium = defaultTypography.displayMedium.copy(fontFamily = FraunecesFontFamily, fontWeight = FontWeight.SemiBold),
    displaySmall = defaultTypography.displaySmall.copy(fontFamily = FraunecesFontFamily, fontWeight = FontWeight.SemiBold),
    headlineLarge = defaultTypography.headlineLarge.copy(fontFamily = FraunecesFontFamily, fontWeight = FontWeight.SemiBold),
    headlineMedium = defaultTypography.headlineMedium.copy(fontFamily = FraunecesFontFamily, fontWeight = FontWeight.SemiBold),
    headlineSmall = defaultTypography.headlineSmall.copy(fontFamily = FraunecesFontFamily, fontWeight = FontWeight.SemiBold),
    titleLarge = defaultTypography.titleLarge.copy(fontFamily = FraunecesFontFamily, fontWeight = FontWeight.Medium),
    titleMedium = defaultTypography.titleMedium.copy(fontFamily = FigtreeFontFamily, fontWeight = FontWeight.SemiBold),
    titleSmall = defaultTypography.titleSmall.copy(fontFamily = FigtreeFontFamily, fontWeight = FontWeight.SemiBold),
    bodyLarge = defaultTypography.bodyLarge.copy(fontFamily = FigtreeFontFamily),
    bodyMedium = defaultTypography.bodyMedium.copy(fontFamily = FigtreeFontFamily),
    bodySmall = defaultTypography.bodySmall.copy(fontFamily = FigtreeFontFamily),
    labelLarge = defaultTypography.labelLarge.copy(fontFamily = FigtreeFontFamily, fontWeight = FontWeight.Medium),
    labelMedium = defaultTypography.labelMedium.copy(fontFamily = FigtreeFontFamily, fontWeight = FontWeight.Medium),
    labelSmall = defaultTypography.labelSmall.copy(fontFamily = FigtreeFontFamily, fontWeight = FontWeight.Medium),
)

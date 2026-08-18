package com.workapp.crew.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.workapp.crew.data.repository.InventoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class ClaimState {
    data object Idle : ClaimState()
    data object InProgress : ClaimState()
    data class Success(val materialId: String, val quantity: Double) : ClaimState()
    data class Failure(val message: String) : ClaimState()
}

@HiltViewModel
class QrShareViewModel @Inject constructor(private val repository: InventoryRepository) : ViewModel() {
    var qrToken by mutableStateOf<String?>(null)
        private set
    var claimState by mutableStateOf<ClaimState>(ClaimState.Idle)
        private set

    fun generateTransfer(materialId: String, quantity: Double) = viewModelScope.launch {
        qrToken = repository.createQrTransfer(materialId, quantity)
    }

    /** Feature 12: the receiving side of a peer-to-peer transfer — decoding a scanned QR token
     * and claiming it immediately credits the scanning technician's truck inventory. */
    fun claim(scannedToken: String) {
        claimState = ClaimState.InProgress
        viewModelScope.launch {
            claimState = try {
                val result = repository.claimQrTransfer(scannedToken)
                ClaimState.Success(result.materialId, result.quantity)
            } catch (e: retrofit2.HttpException) {
                val message = when (e.code()) {
                    409 -> "This transfer was already claimed."
                    400 -> "This QR code has expired or is invalid."
                    else -> "Couldn't claim transfer (${e.code()}). Try again."
                }
                ClaimState.Failure(message)
            } catch (e: java.io.IOException) {
                ClaimState.Failure("Can't reach the server. Check your connection.")
            }
        }
    }

    fun dismissClaimResult() {
        claimState = ClaimState.Idle
    }
}

/** Feature 12: peer-to-peer material transfer via a signed, short-lived QR token. */
@Composable
fun QrShareScreen(viewModel: QrShareViewModel = hiltViewModel()) {
    var materialId by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }

    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { viewModel.claim(it) }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Share Materials", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))

        OutlinedTextField(value = materialId, onValueChange = { materialId = it }, label = { Text("Material ID") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = quantity, onValueChange = { quantity = it }, label = { Text("Quantity") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        Button(onClick = { viewModel.generateTransfer(materialId, quantity.toDoubleOrNull() ?: 1.0) }, modifier = Modifier.fillMaxWidth()) {
            Text("Generate QR to hand off")
        }

        viewModel.qrToken?.let { token ->
            Spacer(Modifier.height(24.dp))
            val bitmap = remember(token) { generateQrBitmap(token, 512) }
            Image(bitmap = bitmap.asImageBitmap(), contentDescription = "Transfer QR code")
            Text("Expires in 2 minutes — have the receiving tech scan this", style = MaterialTheme.typography.bodySmall)
        }

        HorizontalDivider(Modifier.padding(vertical = 24.dp))

        OutlinedButton(
            onClick = {
                scanLauncher.launch(
                    ScanOptions()
                        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        .setPrompt("Scan a crewmate's transfer QR code")
                        .setBeepEnabled(true)
                        .setOrientationLocked(true),
                )
            },
            enabled = viewModel.claimState !is ClaimState.InProgress,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (viewModel.claimState is ClaimState.InProgress) "Claiming…" else "Scan to receive materials")
        }

        when (val state = viewModel.claimState) {
            is ClaimState.Success -> ClaimResultBanner(
                text = "Received ${state.quantity.toInt()} unit(s) of ${state.materialId}.",
                isError = false,
                onDismiss = viewModel::dismissClaimResult,
            )
            is ClaimState.Failure -> ClaimResultBanner(text = state.message, isError = true, onDismiss = viewModel::dismissClaimResult)
            else -> Unit
        }
    }
}

@Composable
private fun ClaimResultBanner(text: String, isError: Boolean, onDismiss: () -> Unit) {
    Spacer(Modifier.height(12.dp))
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text(text, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss) { Text("OK") }
        }
    }
}

private fun generateQrBitmap(content: String, size: Int): android.graphics.Bitmap {
    val bits = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
    val bitmap = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.RGB_565)
    for (x in 0 until size) {
        for (y in 0 until size) {
            bitmap.setPixel(x, y, if (bits[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
    }
    return bitmap
}

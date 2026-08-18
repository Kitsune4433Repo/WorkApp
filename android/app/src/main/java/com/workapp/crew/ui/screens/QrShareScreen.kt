package com.workapp.crew.ui.screens

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
import com.workapp.crew.data.repository.InventoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class QrShareViewModel @Inject constructor(private val repository: InventoryRepository) : ViewModel() {
    var qrToken by mutableStateOf<String?>(null)
        private set

    fun generateTransfer(materialId: String, quantity: Double) = viewModelScope.launch {
        qrToken = repository.createQrTransfer(materialId, quantity)
    }

    fun claim(token: String) = viewModelScope.launch {
        repository.claimQrTransfer(token)
    }
}

/** Feature 12: peer-to-peer material transfer via a signed, short-lived QR token. */
@Composable
fun QrShareScreen(viewModel: QrShareViewModel = hiltViewModel()) {
    var materialId by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Share Materials", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))

        OutlinedTextField(value = materialId, onValueChange = { materialId = it }, label = { Text("Material ID") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = quantity, onValueChange = { quantity = it }, label = { Text("Quantity") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        Button(onClick = { viewModel.generateTransfer(materialId, quantity.toDoubleOrNull() ?: 1.0) }) {
            Text("Generate QR")
        }

        viewModel.qrToken?.let { token ->
            Spacer(Modifier.height(24.dp))
            val bitmap = remember(token) { generateQrBitmap(token, 512) }
            Image(bitmap = bitmap.asImageBitmap(), contentDescription = "Transfer QR code")
            Text("Expires in 2 minutes", style = MaterialTheme.typography.bodySmall)
        }

        // A separate "Scan to claim" flow launches zxing-android-embedded's ScanContract and
        // calls viewModel.claim(scannedToken) with the decoded token, mirroring generateTransfer.
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

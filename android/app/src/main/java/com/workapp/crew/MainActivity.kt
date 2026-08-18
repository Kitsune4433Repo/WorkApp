package com.workapp.crew

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.workapp.crew.ui.screens.*
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val navController = rememberNavController()
                    NavHost(navController = navController, startDestination = "clock_in") {
                        composable("clock_in") { ClockInScreen() }
                        composable("inventory") { InventoryScreen() }
                        composable("map_editor/{documentId}") { backStackEntry ->
                            MapEditorScreen(documentId = backStackEntry.arguments?.getString("documentId").orEmpty())
                        }
                        composable("qr_share") { QrShareScreen() }
                        composable("photo_proof/{jobId}") { backStackEntry ->
                            PhotoProofScreen(jobId = backStackEntry.arguments?.getString("jobId").orEmpty())
                        }
                    }
                }
            }
        }
    }
}

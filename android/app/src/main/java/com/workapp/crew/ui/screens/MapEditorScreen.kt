package com.workapp.crew.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.squareup.moshi.Moshi
import com.workapp.crew.data.local.dao.DocumentDao
import com.workapp.crew.data.local.entities.MapAnnotationEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class StrokePoint(val x: Float, val y: Float)
data class StrokePath(val points: List<StrokePoint>, val colorArgb: Long, val widthDp: Float)

@HiltViewModel
class MapEditorViewModel @Inject constructor(
    private val documentDao: DocumentDao,
    private val moshi: Moshi,
) : ViewModel() {
    var strokes by mutableStateOf(listOf<StrokePath>())
        private set
    private val clientId = UUID.randomUUID().toString()

    fun addStroke(stroke: StrokePath) {
        strokes = strokes + stroke
    }

    fun undo() {
        strokes = strokes.dropLast(1)
    }

    /** Feature 7 + 9: persists the redline layer locally; SyncWorker pushes it and the backend
     * flags a conflict for admin review if another device's layer arrived first with a newer
     * version, rather than silently overwriting either technician's markup. */
    fun save(documentId: String, documentVersion: Int) = viewModelScope.launch {
        val adapter = moshi.adapter(List::class.java)
        val json = adapter.toJson(strokes.map {
            mapOf("points" to it.points.map { p -> mapOf("x" to p.x, "y" to p.y) }, "color" to it.colorArgb, "width" to it.widthDp)
        })
        documentDao.insertAnnotation(
            MapAnnotationEntity(
                documentId = documentId,
                documentVersion = documentVersion,
                layerDataJson = json,
                localVersion = 1,
                clientId = clientId,
            ),
        )
    }
}

/** Feature 7: freehand draw/redline/highlight overlay on a cached property map, fully offline. */
@Composable
fun MapEditorScreen(documentId: String, viewModel: MapEditorViewModel = hiltViewModel()) {
    var currentPoints by remember { mutableStateOf(listOf<StrokePoint>()) }
    var selectedColor by remember { mutableStateOf(Color.Red) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(Color.Red, Color.Yellow, Color(0xFF22C55E)).forEach { color ->
                Button(onClick = { selectedColor = color }, colors = ButtonDefaults.buttonColors(containerColor = color)) {
                    Text(if (color == selectedColor) "✓" else " ")
                }
            }
            OutlinedButton(onClick = { viewModel.undo() }) { Text("Undo") }
            Button(onClick = { viewModel.save(documentId, documentVersion = 1) }) { Text("Save") }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            // The cached map/PDF page render sits beneath this Canvas as an Image composable in
            // the full implementation (bitmap loaded from DocumentEntity.localFilePath).
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectDragGestures(
                            onDragStart = { offset -> currentPoints = listOf(StrokePoint(offset.x, offset.y)) },
                            onDrag = { change, _ ->
                                currentPoints = currentPoints + StrokePoint(change.position.x, change.position.y)
                            },
                            onDragEnd = {
                                if (currentPoints.size > 1) {
                                    viewModel.addStroke(StrokePath(currentPoints, selectedColor.value.toLong(), 4f))
                                }
                                currentPoints = emptyList()
                            },
                        )
                    },
            ) {
                (viewModel.strokes + listOfNotNull(
                    if (currentPoints.size > 1) StrokePath(currentPoints, selectedColor.value.toLong(), 4f) else null,
                )).forEach { stroke ->
                    val path = androidx.compose.ui.graphics.Path().apply {
                        stroke.points.firstOrNull()?.let { moveTo(it.x, it.y) }
                        stroke.points.drop(1).forEach { lineTo(it.x, it.y) }
                    }
                    drawPath(path, color = Color(stroke.colorArgb), style = Stroke(width = stroke.widthDp))
                }
            }
        }
    }
}

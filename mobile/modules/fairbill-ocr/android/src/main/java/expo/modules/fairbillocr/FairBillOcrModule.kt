package expo.modules.fairbillocr

import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private data class Fragment(val text: String, val bounds: Rect)

// ML Kit sometimes returns a separate text block for each column of a bill.
// Rejoin fragments on the same baseline so a price stays beside its description.
private fun pageText(result: Text): String {
  val fragments = result.textBlocks.flatMap { block ->
    block.lines.map { line ->
      val bounds = line.boundingBox ?: return result.text
      Fragment(line.text, bounds)
    }
  }.sortedBy { it.bounds.centerY() }
  val rows = mutableListOf<MutableList<Fragment>>()
  for (fragment in fragments) {
    val row = rows.lastOrNull()
    val anchor = row?.firstOrNull()?.bounds
    val overlap = if (anchor == null) 0 else
      minOf(anchor.bottom, fragment.bounds.bottom) - maxOf(anchor.top, fragment.bounds.top)
    if (row != null && anchor != null && overlap > 0 &&
      overlap * 2 >= minOf(anchor.height(), fragment.bounds.height())) {
      row.add(fragment)
    } else {
      rows.add(mutableListOf(fragment))
    }
  }
  return rows.joinToString("\n") { row ->
    row.sortedBy { it.bounds.left }.joinToString(" ") { it.text.trim() }
  }
}

class FairBillOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FairBillOcr")

    AsyncFunction("readImage") { uriString: String, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val uri = Uri.parse(uriString)
      require(uri.scheme in setOf("file", "content")) { "Choose a local image." }
      val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
      require(options.outWidth in 1..10000 && options.outHeight in 1..10000 &&
        options.outWidth.toLong() * options.outHeight <= 16_000_000) { "Resize the image and retry." }
      val image = InputImage.fromFilePath(context, uri)
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        recognizer.process(image)
          .addOnSuccessListener { result ->
            val text = pageText(result)
            promise.resolve(text.takeIf { it.isNotBlank() && it.length <= 16000 })
          }
          .addOnFailureListener { error ->
            promise.reject("ERR_DEVICE_OCR", "The photo could not be read on this device.", error)
          }
          .addOnCompleteListener { recognizer.close() }
      } catch (error: Exception) {
        recognizer.close()
        throw error
      }
    }
  }
}

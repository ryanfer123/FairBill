package expo.modules.fairbillocr

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.core.content.FileProvider
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val PDF_TYPE = "application/pdf"
private const val PACKET_NAME = "FairBill-evidence.pdf"

class FairBillPacketProvider : FileProvider()

private object ViewPacket : AppContextActivityResultContract<String, Unit> {
  override fun createIntent(context: Context, input: String): Intent {
    val uri = Uri.parse(input)
    return Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, PDF_TYPE)
      clipData = ClipData.newRawUri(PACKET_NAME, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
  }

  override fun parseResult(input: String, resultCode: Int, intent: Intent?) = Unit
}

private object CreatePacket : AppContextActivityResultContract<String, Uri?> {
  override fun createIntent(context: Context, input: String) = Intent(Intent.ACTION_CREATE_DOCUMENT)
    .addCategory(Intent.CATEGORY_OPENABLE)
    .setType(PDF_TYPE)
    .putExtra(Intent.EXTRA_TITLE, input)
    .putExtra(Intent.EXTRA_LOCAL_ONLY, true)

  override fun parseResult(input: String, resultCode: Int, intent: Intent?): Uri? =
    if (resultCode == Activity.RESULT_OK) intent?.data?.takeIf { it.scheme == "content" } else null
}

class FairBillPdfModule : Module() {
  private lateinit var viewer: AppContextActivityResultLauncher<String, Unit>
  private lateinit var picker: AppContextActivityResultLauncher<String, Uri?>

  override fun definition() = ModuleDefinition {
    Name("FairBillPdf")

    RegisterActivityContracts {
      viewer = registerForActivityResult(ViewPacket)
      picker = registerForActivityResult(CreatePacket)
    }

    AsyncFunction("openPdf") Coroutine { fileUri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val file = packetFile(context, fileUri)
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.fairbill.packets", file)
      try {
        withContext(Dispatchers.Main) { viewer.launch(uri.toString()) }
      } catch (_: ActivityNotFoundException) {
        throw CodedException("No PDF viewer is installed. You can save a copy instead.")
      } finally {
        context.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    }

    AsyncFunction("savePdf") Coroutine { fileUri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val file = packetFile(context, fileUri)
      val destination = try {
        withContext(Dispatchers.Main) { picker.launch(PACKET_NAME) }
      } catch (_: ActivityNotFoundException) {
        throw CodedException("Android could not open the file picker.")
      }
      if (destination == null) return@Coroutine false
      withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        try {
          file.inputStream().use { input ->
            val stream = resolver.openOutputStream(destination, "w")
              ?: throw CodedException("The chosen location could not be written to.")
            stream.use { output -> input.copyTo(output) }
          }
        } catch (error: Exception) {
          runCatching { DocumentsContract.deleteDocument(resolver, destination) }
          throw CodedException("FairBill could not save the PDF in the chosen location.", error)
        }
      }
      true
    }
  }

  private fun packetFile(context: Context, fileUri: String): File {
    val uri = Uri.parse(fileUri)
    val path = uri.path ?: throw CodedException("The redacted PDF is unavailable.")
    val file = File(path).canonicalFile
    val root = File(context.cacheDir, "fairbill-packets").canonicalFile
    val folder = file.parentFile
    if (uri.scheme != "file" || folder?.parentFile != root || file.name != PACKET_NAME || !file.isFile) {
      throw CodedException("The redacted PDF is unavailable.")
    }
    return file
  }
}

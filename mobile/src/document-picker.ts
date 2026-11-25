import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { Kind } from './api';

export type CaptureMethod = 'file' | 'photo' | 'camera';

export async function pickDocument(method: CaptureMethod) {
  if (method === 'file') {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/png', 'image/jpeg'],
      copyToCacheDirectory: true,
    });
    const asset = result.assets?.[0];
    return asset && { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream' };
  }

  if (method === 'camera' && Platform.OS === 'android') {
    const { default: scanner } = await import('react-native-document-scanner-plugin');
    const result = await scanner.scanDocument({ maxNumDocuments: 1 });
    if (result.status === 'cancel') return undefined;
    const uri = result.scannedImages?.[0];
    if (!uri) throw new Error('No page was captured. Try again or choose an existing photo.');
    return { uri, name: 'scan.jpg', type: 'image/jpeg' };
  }

  if (method === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
    throw new Error('Allow camera access in device Settings or choose an existing file.');
  }

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, exif: false };
  const result = method === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.assets?.[0];
  return asset && { uri: asset.uri, name: asset.fileName ?? 'scan.jpg', type: asset.mimeType ?? 'image/jpeg' };
}

export type PickedDocument = NonNullable<Awaited<ReturnType<typeof pickDocument>>>;

export function documentForm(kind: Kind, revision: number, asset: PickedDocument) {
  const form = new FormData();
  form.append('kind', kind);
  form.append('revision', String(revision));
  form.append('file', new File(asset.uri));
  return form;
}

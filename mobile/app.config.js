module.exports = ({ config }) => {
  const play = process.env.FAIRBILL_PLAY_BUILD === '1';
  const expoExtra = { ...config.extra };
  for (const key of ['fairbillLocalApi', 'fairbillHostedApi', 'fairbillSupabaseUrl', 'fairbillSupabaseKey', 'fairbillPrivacyUrl']) {
    delete expoExtra[key];
  }
  if (process.env.FAIRBILL_LOCAL_DEV === '1') {
    if (play) {
      throw new Error('A Play build must use the hosted FairBill service.');
    }
    return {
      ...config,
      extra: { ...expoExtra, fairbillLocalApi: 'http://127.0.0.1:8765' },
      plugins: config.plugins.map((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
        ? [plugin[0], { ...plugin[1], android: { ...plugin[1].android, usesCleartextTraffic: true } }]
        : plugin),
    };
  }

  let api;
  try {
    api = new URL(process.env.FAIRBILL_RELEASE_API_URL ?? 'https://fairbill-api.onrender.com');
  } catch {
    throw new Error('Set FAIRBILL_RELEASE_API_URL to the HTTPS FairBill API origin.');
  }
  if (api.protocol !== 'https:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash
      || api.hostname === 'localhost' || api.hostname.endsWith('.local') || /^\d+(\.\d+){3}$/.test(api.hostname) || api.hostname.includes(':')) {
    throw new Error('The FairBill release needs an HTTPS origin with a public DNS name.');
  }

  const cloud = process.env.FAIRBILL_CLOUD_BUILD !== '0';
  if (play && !cloud) throw new Error('A Play build must use the hosted FairBill service, not the tester fixture service.');
  const supabaseUrl = process.env.FAIRBILL_SUPABASE_URL ?? 'https://ehqolzlwsjvnwiervyid.supabase.co';
  const supabaseKey = process.env.FAIRBILL_SUPABASE_PUBLISHABLE_KEY;
  const privacyUrl = process.env.FAIRBILL_PRIVACY_URL ?? `${api.origin}/privacy`;
  if (cloud && (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl ?? '')
      || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseKey ?? '')
      || !/^https:\/\/[^\s]+$/.test(privacyUrl ?? ''))) {
    throw new Error('Set FAIRBILL_SUPABASE_PUBLISHABLE_KEY and verify the FairBill Supabase and privacy URLs.');
  }

  return {
    ...config,
    extra: {
      ...expoExtra, fairbillHostedApi: api.origin,
      ...(cloud ? { fairbillSupabaseUrl: supabaseUrl, fairbillSupabaseKey: supabaseKey, fairbillPrivacyUrl: privacyUrl } : {}),
    },
    android: {
      ...config.android,
      blockedPermissions: [...new Set([
        ...(config.android?.blockedPermissions ?? []),
        ...(cloud ? [] : ['android.permission.CAMERA']),
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ])],
    },
    plugins: config.plugins.map((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
      ? [plugin[0], { ...plugin[1], android: { ...plugin[1].android, usesCleartextTraffic: false } }]
      : cloud && Array.isArray(plugin) && plugin[0] === 'expo-image-picker'
        ? [plugin[0], { ...plugin[1], cameraPermission: 'FairBill uses the camera to capture bills you choose to review.' }]
        : plugin),
  };
};

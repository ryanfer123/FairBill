module.exports = ({ config }) => {
  if (process.env.FAIRBILL_PLAY_BUILD !== '1') return config;

  let api;
  try {
    api = new URL(process.env.FAIRBILL_RELEASE_API_URL);
  } catch {
    throw new Error('Set FAIRBILL_RELEASE_API_URL to the HTTPS FairBill API origin.');
  }
  if (api.protocol !== 'https:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash
      || api.hostname === 'localhost' || api.hostname.endsWith('.local') || /^\d+(\.\d+){3}$/.test(api.hostname) || api.hostname.includes(':')) {
    throw new Error('The FairBill release needs an HTTPS origin with a public DNS name.');
  }

  return {
    ...config,
    extra: { ...config.extra, fairbillHostedApi: api.origin },
    android: {
      ...config.android,
      blockedPermissions: [...new Set([
        ...(config.android?.blockedPermissions ?? []),
        'android.permission.CAMERA',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ])],
    },
    plugins: config.plugins.map((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
      ? [plugin[0], { ...plugin[1], android: { ...plugin[1].android, usesCleartextTraffic: false } }]
      : plugin),
  };
};

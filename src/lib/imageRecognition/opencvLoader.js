// OpenCV.js をアプリ内の public/opencv/opencv.js からロードする
// （CDN は COEP ヘッダーでブロックされるためローカル配置）
const OPENCV_CDN = '/opencv/opencv.js';

let cvPromise = null;

export function loadOpenCV() {
  if (cvPromise) return cvPromise;

  cvPromise = new Promise((resolve, reject) => {
    // すでにロード済みなら即返す
    if (typeof window.cv !== 'undefined' && window.cv.Mat) {
      resolve(window.cv);
      return;
    }

    // onRuntimeInitialized をスクリプト挿入前にセット
    window.Module = {
      ...(window.Module || {}),
      onRuntimeInitialized() {
        clearTimeout(timeoutId);
        resolve(window.cv);
      },
    };

    const script = document.createElement('script');
    script.src = OPENCV_CDN;
    script.async = true;
    script.onerror = () => reject(new Error('OpenCV CDN load failed — ネット接続を確認してください'));
    document.head.appendChild(script);

    // ロードはできたが onRuntimeInitialized が来ない場合のポーリング保険
    const timeoutId = setTimeout(() => {
      const poll = setInterval(() => {
        if (typeof window.cv !== 'undefined' && window.cv.Mat) {
          clearInterval(poll);
          resolve(window.cv);
        }
      }, 200);
      setTimeout(() => {
        clearInterval(poll);
        reject(new Error('OpenCV WASM の初期化がタイムアウトしました'));
      }, 20000);
    }, 5000);
  });

  return cvPromise;
}

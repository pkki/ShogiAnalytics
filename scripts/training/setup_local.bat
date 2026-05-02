@echo off
echo === 将棋学習環境セットアップ (D:\shogi_training) ===
echo.

:: 作業ディレクトリ
set WORK_DIR=D:\shogi_training
mkdir "%WORK_DIR%" 2>nul

:: Python 3.12 で仮想環境を作成
echo [1/3] Python 3.12 で仮想環境を作成中...
py -3.12 -m venv "%WORK_DIR%\venv"
if errorlevel 1 (
    echo エラー: Python 3.12 が見つかりません
    pause & exit /b 1
)

:: パッケージインストール
echo [2/3] パッケージをインストール中（数分かかります）...
"%WORK_DIR%\venv\Scripts\pip" install --upgrade pip -q
"%WORK_DIR%\venv\Scripts\pip" install tensorflow tensorflowjs opencv-python numpy -q
if errorlevel 1 (
    echo エラー: パッケージのインストールに失敗しました
    pause & exit /b 1
)

:: スクリプトをコピー
echo [3/3] スクリプトをコピー中...
copy /Y "%~dp0train.py"    "%WORK_DIR%\train.py"    >nul
copy /Y "%~dp0augment.py"  "%WORK_DIR%\augment.py"  >nul

echo.
echo ✓ セットアップ完了！
echo.
echo 次のステップ:
echo   1. 管理者ページからエクスポートした ZIP を D:\shogi_training\ に置く
echo   2. run_training.bat を実行する
echo.
pause

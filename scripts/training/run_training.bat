@echo off
echo === 将棋駒認識モデル 学習 ===
echo.

set WORK_DIR=D:\shogi_training
set VENV=%WORK_DIR%\venv\Scripts
set DATASET=%WORK_DIR%\dataset
set DATASET_AUG=%WORK_DIR%\dataset_aug
set MODEL_OUT=%WORK_DIR%\model_out

:: 仮想環境確認
if not exist "%VENV%\python.exe" (
    echo エラー: 仮想環境が見つかりません。先に setup_local.bat を実行してください。
    pause & exit /b 1
)

:: ZIPの展開
echo [1/4] ZIPファイルを探しています...
for %%f in ("%WORK_DIR%\shogi_training_*.zip") do (
    set ZIP_FILE=%%f
    goto :found_zip
)
echo ZIPが見つかりません。%WORK_DIR%\ にエクスポートしたZIPを置いてください。
pause & exit /b 1

:found_zip
echo 見つかりました: %ZIP_FILE%
echo [2/4] ZIPを展開中...
if not exist "%DATASET%" (
    powershell -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%WORK_DIR%' -Force"
) else (
    echo dataset フォルダが既に存在します。スキップします。
)

:: データ件数確認
echo.
echo --- データ件数 ---
"%VENV%\python.exe" -c "
import os
d = r'%DATASET%'
total = 0
for cls in sorted(os.listdir(d)):
    p = os.path.join(d, cls)
    if os.path.isdir(p):
        n = len([f for f in os.listdir(p) if f.endswith('.png')])
        total += n
        if n > 0:
            print(f'  {cls}: {n}')
print(f'  合計: {total}枚')
"

:: データ拡張（任意）
echo.
set /p DO_AUG="データ拡張しますか？少ない場合は推奨 (y/n): "
if /i "%DO_AUG%"=="y" (
    echo [3/4] データ拡張中...
    set /p TIMES="1枚あたり何枚生成しますか？（推奨: 15）: "
    "%VENV%\python.exe" "%WORK_DIR%\augment.py" "%DATASET%" --times %TIMES% --out "%DATASET_AUG%"
    set TRAIN_DATA=%DATASET_AUG%
) else (
    echo [3/4] データ拡張スキップ
    set TRAIN_DATA=%DATASET%
)

:: 学習
echo.
echo [4/4] 学習開始...
mkdir "%MODEL_OUT%" 2>nul
"%VENV%\python.exe" "%WORK_DIR%\train.py" --data "%TRAIN_DATA%" --out "%MODEL_OUT%"
if errorlevel 1 (
    echo エラー: 学習に失敗しました
    pause & exit /b 1
)

:: 完了
echo.
echo ✓ 学習完了！
echo.
echo モデルファイル:
dir "%MODEL_OUT%"
echo.
echo 次のステップ:
echo   %MODEL_OUT%\ の中身を
echo   ShogiAnalytics\public\shogi-model\ に上書きコピーして
echo   npm run build を実行してください。
echo.
pause

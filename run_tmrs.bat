@echo off
chcp 65001 >nul
cd /d %~dp0
echo ========================================
echo   TMRS Pattern Maker 시작 중...
echo ========================================

:: 가상환경 없으면 생성
if not exist venv (
    echo [1/3] 가상 환경 생성 중...
    python -m venv venv
)

:: 가상환경 활성화
call venv\Scripts\activate

:: 라이브러리 설치
echo [2/3] 라이브러리 확인 중...
python -m pip install -r requirements.txt --quiet

:: 브라우저 열기 + 서버 실행
echo [3/3] 서버 시작!
echo.
echo  브라우저에서 http://localhost:5000 접속하세요
echo  종료하려면 이 창을 닫으세요
echo ========================================
start http://localhost:5000
python app.py
pause

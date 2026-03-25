# Jungle LMS Study Day Automation

Jungle LMS에서 다음 작업을 자동화하는 Windows용 스크립트입니다.

- Google SSO 로그인 세션 재사용
- 프로그램 실행 후 아직 시작 전이면 `학습 시작` 자동 처리
- 사용자가 지정한 종료 시각에 `학습 종료` 자동 처리
- 백그라운드 실행 및 시스템 트레이 상태 표시

종료 시각은 실행할 때 직접 입력합니다.
허용 범위는 `23:00 ~ 익일 03:00`이며, 예시는 `23:00`, `01:00`, `02:30`입니다.

## 1. 요구 사항

- Windows
- Node.js `24` 이상
- Google Chrome 설치
- Jungle LMS 계정
- 최초 1회 Google 로그인 수동 완료 가능 환경

## 2. 설치

프로젝트 폴더에서 한 번만 실행합니다.

```powershell
npm.cmd install
```

## 3. 최초 1회 로그인 준비

Google의 기기 승인, CAPTCHA, 추가 인증이 나올 수 있으므로 처음에는 자동 로그인이 아니라 수동 세션 저장이 필요할 수 있습니다.

가장 안전한 방법:

1. [BootstrapLogin.bat](/C:/DDingHo/OtherProject/BootstrapLogin.bat)을 실행합니다.
2. 열린 Chrome 창에서 Jungle LMS Google 로그인을 직접 완료합니다.
3. 창을 닫습니다.
4. 필요하면 아래 명령으로 세션을 확인합니다.

```powershell
npm.cmd run verify
```

정상이라면 Jungle LMS 세션이 저장되어 이후 자동화가 그 프로필을 재사용합니다.

## 4. 가장 쉬운 사용 방법

매일 사용할 때는 [RunStudyDay.bat](/C:/DDingHo/OtherProject/RunStudyDay.bat)만 더블클릭하면 됩니다.

동작 순서:

1. 배치 파일이 콘솔 창을 엽니다.
2. 종료 시간을 물어봅니다.
3. `23:00 ~ 익일 03:00` 사이 값을 입력합니다.
4. 예시처럼 `23:00`, `01:00`, `02:30` 형식으로 입력합니다.
5. 프로그램이 백그라운드로 실행되고 시스템 트레이도 같이 시작합니다.

입력 예시:

```text
학습 종료 시간을 입력하세요 (23:00 ~ 익일 03:00 사이의 값을 입력하세요. 예: 23:00, 01:00, 02:30): 01:00
```

해석 방식:

- `23:00` -> 당일 밤 11시 종료
- `01:00` -> 다음 날 새벽 1시 종료
- `02:30` -> 다음 날 새벽 2시 30분 종료
- `03:00` -> 다음 날 새벽 3시 종료
- `22:59`, `03:30` -> 허용되지 않음

## 5. 하루 자동화 흐름

`RunStudyDay.bat` 또는 `npm.cmd run study-day` 실행 후 내부 흐름은 다음과 같습니다.

1. 이미 백그라운드 작업이 실행 중인지 확인합니다.
2. 실행 중이 아니면 종료 시각을 입력받습니다.
3. 백그라운드 프로세스를 시작합니다.
4. 시스템 트레이 아이콘을 시작합니다.
5. Jungle LMS 체크인 페이지에서 현재 상태를 확인합니다.
6. 아직 시작 전이면 실행 시점 기준으로 바로 `학습 시작`을 시도합니다.
7. 이미 학습 중이면 시작은 건너뛰고 종료 대기로 들어갑니다.
8. 사용자가 입력한 종료 시각까지 기다립니다.
9. 종료 시각이 되면 `학습 종료` 버튼이 활성화될 때까지 새로고침하며 대기합니다.
10. `학습 종료` 클릭 후 확인 다이얼로그까지 처리합니다.
11. 성공 여부를 검증하고 로그와 상태 파일을 남깁니다.

## 6. 시스템 트레이

백그라운드로 실행 중이면 시스템 트레이 아이콘이 표시됩니다.
작업표시줄 오른쪽의 숨겨진 아이콘 영역에 들어갈 수 있습니다.

트레이 메뉴:

- `Start Background`
- `Stop Background`
- `Open Log`
- `Open Status JSON`
- `Exit Tray`

주의:

- `Start Background`는 종료 시간 입력이 필요해서 보이는 `cmd` 창을 띄웁니다.
- 트레이는 상태 표시용이며, 실제 자동화는 별도 백그라운드 프로세스가 수행합니다.

## 7. 배치 파일 목록

### [RunStudyDay.bat](/C:/DDingHo/OtherProject/RunStudyDay.bat)
하루 자동화를 시작합니다. 종료 시간을 물어본 뒤 백그라운드 실행합니다.

### [StudyDayStatus.bat](/C:/DDingHo/OtherProject/StudyDayStatus.bat)
현재 백그라운드 상태를 확인합니다.

### [StopStudyDay.bat](/C:/DDingHo/OtherProject/StopStudyDay.bat)
현재 실행 중인 백그라운드 자동화를 중지합니다.

### [BootstrapLogin.bat](/C:/DDingHo/OtherProject/BootstrapLogin.bat)
최초 로그인 세션 저장용 수동 Chrome 로그인을 엽니다.

## 8. CLI 명령

배치 파일 대신 터미널에서 직접 실행하려면 아래 명령을 사용합니다.

### 기본

```powershell
npm.cmd run study-day
npm.cmd run study-day -- --end-time 01:00
npm.cmd run study-day:status
npm.cmd run study-day:stop
```

### 로그인 관련

```powershell
npm.cmd run verify
npm.cmd run login
npm.cmd run login:fresh
npm.cmd run bootstrap
npm.cmd run bootstrap:fresh
```

### 개별 동작

`start-study`는 고정 10시를 기다리지 않고 실행 시점부터 즉시 시작 시도를 진행합니다.

```powershell
npm.cmd run start-study
npm.cmd run end-study
npm.cmd run study-day:foreground
```

### 트레이 관련

```powershell
npm.cmd run study-day:tray
npm.cmd run study-day:tray:status
npm.cmd run study-day:tray:stop
```

## 9. 로그와 상태 파일

백그라운드 실행 상태는 아래 경로에 저장됩니다.

- 로그: [study-day.log](/C:/DDingHo/OtherProject/.local/background/study-day.log)
- 상태: [study-day.status.json](/C:/DDingHo/OtherProject/.local/background/study-day.status.json)
- 트레이 PID: [study-day.tray.pid.json](/C:/DDingHo/OtherProject/.local/background/study-day.tray.pid.json)

실패 시 Playwright 캡처와 HTML은 `.artifacts` 아래에 저장됩니다.

## 10. 주의 사항

- Google 세션이 만료되면 다시 수동 로그인이나 CAPTCHA 처리가 필요할 수 있습니다.
- PC가 종료, 재부팅, 절전되면 백그라운드 작업도 중단될 수 있습니다.
- Jungle LMS 화면 구조가 바뀌면 버튼 탐지 로직을 수정해야 할 수 있습니다.
- `study-day`는 동시에 하나만 실행되도록 되어 있습니다.

## 11. 추천 사용 순서

처음 한 번:

1. `npm.cmd install`
2. [BootstrapLogin.bat](/C:/DDingHo/OtherProject/BootstrapLogin.bat) 실행
3. Google 로그인 직접 완료
4. `npm.cmd run verify`

매일:

1. [RunStudyDay.bat](/C:/DDingHo/OtherProject/RunStudyDay.bat) 실행
2. 종료 시간 입력
3. 필요하면 [StudyDayStatus.bat](/C:/DDingHo/OtherProject/StudyDayStatus.bat)으로 상태 확인
4. 중지해야 하면 [StopStudyDay.bat](/C:/DDingHo/OtherProject/StopStudyDay.bat) 실행

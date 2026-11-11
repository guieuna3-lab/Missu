# 외부 연동과 운영 도구

## 개발 모드와 실제 서비스 구분

현재 Windows 개발 기본값은 EMAIL_PROVIDER=local, SMS_PROVIDER=local, PLACE_PROVIDER=disabled, STORAGE_PROVIDER=local입니다.
로컬 인증은 .local/outbox에만 기록합니다. 운영 환경은 로컬 발송 대역과 미확정 POLICY_VERSION으로 시작할 수 없습니다.

| 연결 | 설정 | 실제 사용 전 필요한 것 |
|---|---|---|
| 이메일 | EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM | 발신 도메인·주소 설정과 실제 수신 시험 |
| SMS | SMS_PROVIDER=solapi, SOLAPI_API_KEY, SOLAPI_API_SECRET, SMS_FROM | 발신번호 등록과 실제 수신 시험 |
| 장소 | PLACE_PROVIDER=kakao, KAKAO_REST_API_KEY | Kakao Local API 사용 권한·쿼터 확인 |
| 사진 | STORAGE_PROVIDER=supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET | 비공개 버킷과 실제 업로드·읽기 시험 |

키는 .env 또는 운영 비밀 설정에 넣고 프런트엔드 코드·소스 ZIP·채팅에 넣지 않습니다.
외부 호출은 5초 제한입니다. 장소 읽기만 1회 재시도하고 이메일/SMS는 자동 재발송하지 않습니다.
Supabase는 시작 시 버킷이 비공개인지 확인합니다. 사진 읽기 주소는 백엔드가 5분 서명으로 발급합니다.
로컬 저장에서 Supabase로 전환할 때 기존 사진 파일도 같은 objectKey로 이전해야 합니다. 환경 변수만 바꿔서는 이전되지 않습니다.

어댑터는 공식 계약을 기준으로 작성하고 모의 응답으로 시험했습니다. 실제 계정 연결 성공을 의미하지 않습니다.

- [Resend 이메일 API](https://resend.com/docs/api-reference/emails/send-email)
- [SOLAPI 인증 방식](https://solapi.com/developers/api/authentication-api-key), [발송 API](https://solapi.com/developers/api/messages)
- [Kakao Local API](https://developers.kakao.com/docs/ko/local/dev-guide)
- [Supabase Storage API](https://supabase.github.io/storage/)

## 만료 자료 정리

~~~powershell
npm.cmd run build
npm.cmd run maintenance
npm.cmd run maintenance -- --apply
~~~

첫 명령은 빌드입니다. maintenance 기본값은 건수 미리보기이고 --apply가 있을 때만 정리합니다.
만료·사용 후 보존 시간이 지난 인증 요청, 24시간 이상 지난 만료/유휴 세션,
만료된 멱등 결과·횟수 제한, 24시간 지난 미연결 사진, 만료된 로컬 인증 파일을 정리합니다.
연결된 사진과 회원·물품·대화·신고 본문은 자동 삭제하지 않습니다.
사진은 실행당 최대 100건이며 반복 실행할 수 있습니다. 여러 서버의 정리 작업은 DB 잠금으로 중복 실행을 막습니다.
일일 자동 실행은 운영 서버의 작업 스케줄러에서 구성해야 하며 이 작업에서는 자동 작업을 등록하지 않았습니다.

## 로컬 개발 백업과 복원 검증

DB를 실행한 상태에서 다음 명령을 사용합니다.

~~~powershell
npm.cmd run backup:local
npm.cmd run backup:verify -- "명령에 표시된 .local/backups 아래 백업 폴더"
~~~

백업은 database.dump, 사진 사본, private.env, manifest.json을 만듭니다.
DB 덤프와 행 수·사진 목록은 같은 PostgreSQL 스냅샷으로 읽습니다. 사진 삭제/정리 작업은 백업 중 실행하지 않습니다.
복원 검증은 새 무작위 이름의 임시 DB에만 복원한 뒤 행 수·사진 해시·암호화 키를 확인하고 해당 임시 DB를 삭제합니다.
기존 missu_dev·missu_test를 덮어쓰지 않습니다. Supabase 원격 사진은 이 로컬 백업 도구의 복사 대상이 아닙니다.

이 백업에는 비밀 설정이 있으므로 공유용 소스 ZIP과 구분합니다. 노트북 장애에 대비한 외부 보관·암호화·보존 주기는
운영 단계에서 별도로 구성해야 합니다. 기존 DB를 삭제하거나 초기화하는 복원 명령을 일상 실행에 사용하지 않습니다.

## 배포 준비

1. 운영용 PostgreSQL·사진 저장소·발송/지도 계정을 준비합니다.
2. 개발 환경과 다른 비밀 키·DB·버킷을 설정하고 POLICY_VERSION을 확정합니다.
3. HTTPS 서비스 주소와 ALLOWED_ORIGINS를 지정합니다. 프런트엔드와 API를 같은 HTTPS 서비스 주소 아래 두면 현재 쿠키 설정에 맞습니다.
4. 역방향 프록시가 있으면 실제 구성에 맞춰 TRUST_PROXY_HOPS를 설정합니다. 기본은 0입니다.
   백엔드 직접 접근이 차단되고 신뢰하는 프록시가 하나인 경우에만 1로 설정합니다.
5. 설치, 빌드, 순차 DB 변경, 시작 순서로 실행합니다.

~~~powershell
npm.cmd ci
npm.cmd run build
npm.cmd run db:migrate
npm.cmd run start:prod
~~~

NODE_ENV=production은 운영 서비스 설정에서 지정합니다. 프런트엔드 연결, 실제 이메일/SMS·지도·원격 사진,
HTTPS 쿠키, 외부 접근 제어, 운영 백업·복원, 실제 단말 시험은 배포 환경에서 별도로 확인해야 합니다.
이 작업에서는 외부 서버 배포나 도메인 구매를 하지 않았습니다.

## 검사와 부하 시험

~~~powershell
npm.cmd test -- --runInBand
npm.cmd run test:e2e
npm.cmd run test:load
npm.cmd run docs:export
~~~

test:load는 로컬 missu_test에 자신만의 합성 회원·물품 1만 건·사진 메타데이터 3만 건을 만들고 정리합니다.
30명 동시 요청, 60초 예열 후 300초 동안 검색·상세·근처 JSON 조회와 분실 신고 변경을 측정합니다.
사진 바이트 다운로드, 외부 서비스, 프런트엔드 렌더링은 이 측정에 포함하지 않습니다.
결과는 .local/load-report.json에 저장됩니다. 운영 응답 시간·가용성을 보증하는 수치는 아닙니다.

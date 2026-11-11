# 새 Windows PC에서 설치하기

현재 사용자의 PC에는 작업 과정에서 설치·연결합니다. 아래는 소스를 다른 PC에 복사했을 때의 절차입니다.

1. Node.js를 설치합니다. 이번 검증 환경은 Node.js 26.13.0, npm 11.20.0입니다.
2. 프로젝트 폴더에서 `npm.cmd ci`를 실행합니다.
3. [EDB 공식 배포 페이지](https://www.enterprisedb.com/download-postgresql-binaries)에서 Windows x86-64 PostgreSQL 17.11 바이너리 ZIP을 받습니다. 프로젝트 `.local/pgsql` 아래에 `bin`, `lib`, `share` 폴더가 위치하도록 압축을 풉니다. 설치형 PostgreSQL이나 기존 DB가 있는 경우 설정을 확인한 뒤 연결 문자열을 사용하며 기존 DB를 초기화하지 않습니다.
4. 아래 순서로 실행합니다.

```powershell
npm.cmd run local:setup
npm.cmd run prisma:generate
npm.cmd run db:migrate
npm.cmd run seed:demo
npm.cmd run start:dev
```

`local:setup`은 새 DB의 비밀번호와 암호화 키를 생성해 `.env`에 저장합니다. 이미 있는 `.env`를 덮어쓰지 않습니다. 기본 포트 54329가 다른 프로그램에 사용 중이면 설정을 검토한 뒤 변경해야 합니다. 임의로 다른 프로세스를 종료하지 않습니다.

`db:migrate`는 기록된 migration만 순서대로 적용합니다. `prisma db push`, `migrate reset`, 데이터 폴더 삭제는 일상적인 실행 명령이 아닙니다.

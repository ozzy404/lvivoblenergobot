# Деплой WebApp на Firebase Hosting

## Автоматичне оновлення версії

Перед деплоєм запусти скрипт для оновлення версій файлів:

```bash
cd webapp
./build.sh
```

Це оновить `?v=` параметр у всіх ресурсах, щоб браузер завантажив свіжі файли.

## Деплой

```bash
cd webapp
firebase deploy --only hosting
```

## Або все разом:

```bash
cd webapp
./build.sh && firebase deploy --only hosting
```

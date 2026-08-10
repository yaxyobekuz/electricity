---
name: uz-tarjima-qoidalari
description: Rules for writing UI text in Uzbek and code values in English.
---

# Language rules (uz/en separation)

## Core rule

| Area | Language |
|---|---|
| UI text (user-visible) | **Uzbek** |
| Code values (id, role, key, route) | **English** |
| File/folder names | **English** |
| Error/response `message` (to the user) | **Uzbek** |
| Logger text (for developers) | **English** |

## Examples

### Correct

```jsx
<Button>Saqlash</Button>
<Input placeholder="To'liq ismni kiriting" />
toast.success("Talaba qo'shildi");
```

```js
const ROLES = { OWNER: "owner", TEACHER: "teacher" };
router.get("/students", ...);
queryKey: ["students", "list"]
throw new ApiError(404, "Talaba topilmadi");
```

### Wrong

```jsx
<Button>Save</Button>                    // ❌ English text
<Input placeholder="Enter full name" />  // ❌
```

```js
const ROLES = { EGA: "ega", O_QITUVCHI: "oqituvchi" };  // ❌ Uzbek values
router.get("/talabalar", ...);                          // ❌ Uzbek route
queryKey: ["talabalar"]                                 // ❌
```

## Special cases

- **Date/number formatting** - Uzbek format on the UI (`12-noyabr 2026`), ISO on the API (`2026-11-12`).
- **Phone number** - `+998 (90) 123-45-67` on the UI, `998901234567` on the API.
- **Form field label** - Uzbek (`"Telefon raqami"`); the input `name` attribute stays English (`name="phone"`).

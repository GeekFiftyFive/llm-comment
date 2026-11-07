# Refactoring plan for the billing service

I looked through `billing/` and found three areas worth changing.

## 1. Split the invoice generator

The `InvoiceGenerator` class currently handles tax calculation,
PDF rendering and email delivery. I propose splitting it into three
classes with a single responsibility each.

## 2. Replace the retry loop

```ts
for (let i = 0; i < 5; i++) {
  try { return await charge(card); } catch { await sleep(1000); }
}
```

This should use exponential backoff with jitter.

## 3. Summary

| Change | Risk | Effort |
|---|---|---|
| Split generator | Low | 2 days |
| Retry backoff | Low | 0.5 days |

- [x] Read the code
- [ ] Write the tests first

Raw HTML is shown as text: <script>alert(1)</script> and an image ![diagram](https://example.com/x.png). See [the docs](https://example.com).

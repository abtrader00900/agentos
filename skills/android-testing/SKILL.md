---
name: android-testing
description: Android (Kotlin) test strategy — unit tests with JUnit5/Robolectric, coroutine test rules, and Compose UI tests with fake repositories. Use when writing, reviewing, or fixing tests for Android code involving ViewModels, coroutines/Flow, Room, or Compose screens.
---

# Android Testing

## When to use

- Writing or reviewing tests for Android Kotlin code
- A ViewModel, UseCase, Repository, DAO, or Compose screen lacks tests
- Flaky coroutine/Flow tests, `Dispatchers.Main` crashes in unit tests, or `LiveData` timing issues

## Rules

1. **Unit tests run on the JVM — no framework, no emulator.** Use JUnit5 (or JUnit4) + Robolectric only when Android framework classes are unavoidable (`Context`, `Bitmap`, etc.). Prefer fakes over mocks for repositories.
2. **Never hardcode `Dispatchers.Main`/IO in classes — inject `CoroutineDispatcher`.** In tests, inject a `StandardTestDispatcher` or `UnconfinedTestDispatcher` and advance time with `advanceUntilIdle()`.
3. **Test Flows with Turbine** (`app.cash.turbine`): collect expectations one emission at a time — no `first()`/`toList()` guessing games.
4. **ViewModel tests** must cover: initial state, loading → success, loading → error, retry, and configuration-independent behavior (no Android framework refs).
5. **Compose tests** (`createComposeRule`): assert on semantic tags (`testTag`), not on implementation details; fake the ViewModel/repository layer — never hit network or real DB.
6. **Room DAO tests** are instrumented OR Robolectric-backed; always run on an in-memory database and close it in `@After`.
7. **Naming:** `methodName_condition_expectedResult` (e.g. `login_withEmptyEmail_emitsValidationError`).
8. One behavior per test. If a test needs "and" in its name, split it.

## Structure

```kotlin
class LoginViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val repo = FakeAuthRepository()          // fake, not mock
    private lateinit var vm: LoginViewModel

    @Before fun setup() {
        Dispatchers.setMain(dispatcher)
        vm = LoginViewModel(repo, dispatcher)
    }

    @After fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun login_withValidCredentials_emitsSuccess() = runTest(dispatcher) {
        vm.login("a@b.c", "pw")
        advanceUntilIdle()
        vm.state.test {
            assertEquals(LoginState.Success, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }
}
```

## Anti-patterns (flag these in review)

- `Thread.sleep()` in tests — use `advanceUntilIdle()` / Turbine timeouts
- `Dispatchers.Main` hardcoded in production classes
- Mocking data classes / sealed classes with Mockito — use fakes
- `println` debugging left in test code
- Android `Log.*` calls crashing unit tests (add a test timber/log rule or avoid)

## Review checklist

- [ ] Coroutines: dispatcher injected, `runTest` used, no real delays
- [ ] Flows asserted via Turbine (or equivalent explicit collection)
- [ ] Error path tested, not just success
- [ ] No network/DB/clock access; time and randomness controlled
- [ ] Compose tests use `testTag`, fake data layer
- [ ] Test names follow `method_condition_expected` convention

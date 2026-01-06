# Project Instructions

## Notification Behavior

When you complete a significant task (build, test, deployment, long-running operation, or any task that took multiple steps), **always use the `ring` tool** to notify the user. This is especially important when:

- A build or compilation finishes
- Tests complete (pass or fail)
- A file generation or processing task completes
- You finish implementing a feature
- An error occurs that needs user attention
- You need user input to continue

Example usage:
```
ring({
  title: "Build Complete",
  message: "The project built successfully. Any changes you'd like me to make?"
})
```

The user can respond through the notification popup, and you'll receive their answer.

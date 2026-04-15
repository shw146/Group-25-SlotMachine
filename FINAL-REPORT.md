#FINAL REPORT

We used claude sonnet 4.6 version 2.1.108

When given identical inputs, a coding agent is pretty inconsistent. With the 50 prototypes that we ran, we found some really good ones, some really bad ones, some that didn't work, and many of them used wildly different amomunts of tokens.

Drift: When working with different projects, refining the project with the same prompt causes different effects to happen. This causes each generation of refinements to drift farther and farther apart in different directions, which we have to force the AI to move back.

When we are doing refinements with the AI, it often lost a lot of the details from the earlier iterations. It tended to veer away from the original prompt's qualities.
For example, our prototypes stopped making fun of AI as we kept refining them and instead started to prioritize UI/graphic effects, becoming more and more generic.

Comments in the code became more encompassing, but once they started getting good, they stopped improving in future refinements.

If a person is trying to use generative AI to create a program, they will likely have to spend a TON of time thinking about what to change and how to get the AI to go in the direction that they want. It shortened the coding process, but forced us to spend a lot more time on other parts of project creation. They also have to have a lot of experience with exactly the thing they are trying to code, because the AI really doesn't know it very well and needs to be hand held through the process.

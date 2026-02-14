# WebPeel + CrewAI Integration

Use WebPeel as a tool in your CrewAI agents for reliable web scraping, searching, and crawling.

## Installation

```bash
pip install crewai webpeel
```

## Usage

```python
from crewai import Agent, Task, Crew
from webpeel_tool import WebPeelScrapeTool, WebPeelSearchTool

# Create tools
scrape_tool = WebPeelScrapeTool(api_key="wp_...")  # Optional for basic usage
search_tool = WebPeelSearchTool(api_key="wp_...")

# Create an agent with web access
researcher = Agent(
    role="Senior Research Analyst",
    goal="Research and analyze web content thoroughly",
    backstory="You are an expert researcher who gathers accurate data from the web.",
    tools=[scrape_tool, search_tool],
    verbose=True,
)

# Create a task
research_task = Task(
    description="Research the top 5 AI frameworks and compare their features",
    expected_output="A detailed comparison table of AI frameworks",
    agent=researcher,
)

# Run the crew
crew = Crew(agents=[researcher], tasks=[research_task])
result = crew.kickoff()
print(result)
```

## Available Tools

| Tool | Description |
|------|-------------|
| `WebPeelScrapeTool` | Scrape a URL and get clean markdown. Supports `render` and `stealth` modes. |
| `WebPeelSearchTool` | Search the web and get results with snippets. |
| `WebPeelCrawlTool` | Crawl a website and get content from multiple pages. |

## Self-Hosted

Point to your own WebPeel instance:

```python
scrape_tool = WebPeelScrapeTool(
    base_url="http://localhost:3000",
    api_key=None,  # No key needed for self-hosted
)
```

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY StackDotnet.csproj ./
RUN dotnet restore
COPY src ./src
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out ./
EXPOSE 5000
USER $APP_UID
ENTRYPOINT ["dotnet", "StackDotnet.dll"]

@echo off
set "COMMIT_MESSAGE=Sauvegarde auto - %date% %time%"

echo --- Démarrage de la sauvegarde Git ---

echo.
echo Etape 1 : Ajout de tous les fichiers.
git add .

echo.
echo Etape 2 : Verification des changements.
git diff --quiet --cached
if %errorlevel% neq 0 (
    echo.
    echo Etape 3 : Creation du commit avec le message : "%COMMIT_MESSAGE%"
    git commit -m "%COMMIT_MESSAGE%"

    echo.
    echo Etape 4 : Poussee des modifications vers GitHub...
    git push origin main
    
    if %errorlevel% equ 0 (
        echo.
        echo Sauvegarde reussie sur GitHub.
    ) else (
        echo.
        echo Echec de la sauvegarde. Verifiez votre connexion et vos acces.
    )
) else (
    echo Aucun changement detecte. Aucune sauvegarde n'est necessaire.
)

echo.
echo --- Sauvegarde terminee ---
pause
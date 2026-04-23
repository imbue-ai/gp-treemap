/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Quartz/Quartz.h>

#import "DirectoryView.h"

#import "DirectoryViewControl.h"

#import "DirectoryItem.h"
#import "TreeContext.h"

#import "TreeLayoutBuilder.h"
#import "TreeDrawer.h"
#import "TreeDrawerSettings.h"
#import "ItemPathDrawer.h"
#import "ItemPathModel.h"
#import "ItemPathModelView.h"
#import "ItemLocator.h"

#import "OverlayDrawer.h"

#import "TreeLayoutTraverser.h"

#import "AsynchronousTaskManager.h"
#import "DrawTaskExecutor.h"
#import "DrawTaskInput.h"
#import "OverlayDrawTaskExecutor.h"
#import "OverlayDrawTaskInput.h"

#import "FileItemMapping.h"
#import "FileItemMappingScheme.h"

#import "LocalizableStrings.h"

static const float SCROLL_WHEEL_SENSITIVITY = 6.0;

static const float ZOOM_ANIMATION_SKIP_THRESHOLD = 0.99;
static const float ZOOM_ANIMATION_MAXLEN_THRESHOLD = 0.80;

NSString  *ColorPaletteChangedEvent = @"colorPaletteChanged";
NSString  *ColorMappingChangedEvent = @"colorMappingChanged";
NSString  *DisplayFocusChangedEvent = @"displayFocusChanged";

CGFloat rectArea(NSRect rect) {
  return rect.size.width * rect.size.height;
}

// Returns 0 when x <= minX, 1 when x >= maxX, and interpolates lineairly when minX < x < maxX.
CGFloat ramp(CGFloat x, CGFloat minX, CGFloat maxX) {
  return MIN(1, MAX(0, x - minX) / (maxX - minX));
}

@interface DirectoryView (PrivateMethods)

- (BOOL) canPerformAction:(SEL)action;

- (void) forceRedraw;
- (void) forceOverlayRedraw;

- (void) startTreeDrawTask;
- (void) itemTreeImageReady:(id)image;

- (void) startOverlayDrawTask;
- (void) overlayImageReady:(id)image;

@property (nonatomic, readonly) TreeDrawer *treeDrawer;

@property (nonatomic, readonly) float animatedOverlayStrength;
- (void) refreshDisplay;
- (void) enablePeriodicRedraw:(BOOL) enable;

- (void) animateZoomIn;
- (void) animateZoomOut;
- (void) startZoomAnimation;
- (void) drawZoomAnimation;
- (void) releaseZoomImages;
- (void) abortZoomAnimation;
- (void) addZoomAnimationCompletionHandler;

- (void) updatePathEndRect:(BOOL)animate;

- (void) postColorPaletteChanged;
- (void) postColorMappingChanged;
- (void) postDisplayFocusChanged;

- (void) selectedItemChanged:(NSNotification *)notification;
- (void) visibleTreeChanged:(NSNotification *)notification;
- (void) visiblePathLockingChanged:(NSNotification *)notification;
- (void) windowMainStatusChanged:(NSNotification *)notification;
- (void) windowKeyStatusChanged:(NSNotification *)notification;

- (void) updateAcceptMouseMovedEvents;

- (void) colorMappingChanged:(NSNotification *)notification;

- (void) updateSelectedItem:(NSPoint)point;
- (void) moveSelectedItem:(DirectionEnum)direction;

// Determines the maximum draw depth for the tree current visible in the view.
- (int) maxDrawDepth;

@end 


@implementation DirectoryView

- (instancetype) initWithFrame:(NSRect)frame {
  if (self = [super initWithFrame:frame]) {
    layoutBuilder = [[TreeLayoutBuilder alloc] init];
    pathDrawer = [[ItemPathDrawer alloc] init];
    selectedItemLocator = [[ItemLocator alloc] init];

    scrollWheelDelta = 0;
  }

  return self;
}

- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];
  
  [drawTaskManager dispose];
  [drawTaskManager release];

  [overlayDrawTaskManager dispose];
  [overlayDrawTaskManager release];

  [redrawTimer invalidate];

  [layoutBuilder release];
  [_overlayTest release];
  [pathDrawer release];
  [selectedItemLocator release];

  [pathModelView release];
  
  [treeImage release];
  [zoomImage release];
  [zoomBackgroundImage release];
  [overlayImage release];
  
  [super dealloc];
}


- (void) postInitWithPathModelView:(ItemPathModelView *)pathModelViewVal {
  NSAssert(pathModelView == nil, @"The path model view should only be set once.");

  pathModelView = [pathModelViewVal retain];
  TreeContext *treeContext = pathModelView.pathModel.treeContext;
  
  DrawTaskExecutor  *drawTaskExecutor =
    [[[DrawTaskExecutor alloc] initWithTreeContext: treeContext] autorelease];
  drawTaskManager = [[AsynchronousTaskManager alloc] initWithTaskExecutor: drawTaskExecutor];

  pathModelView.drawItems = self.treeDrawerSettings.drawItems;
  pathModelView.displayDepth = self.treeDrawerSettings.displayDepth;

  OverlayDrawTaskExecutor  *overlayDrawTaskExecutor =
    [[[OverlayDrawTaskExecutor alloc] initWithScanTree: treeContext.scanTree] autorelease];
  overlayDrawTaskManager =
    [[AsynchronousTaskManager alloc] initWithTaskExecutor: overlayDrawTaskExecutor];

  NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;

  [nc addObserver: self
         selector: @selector(selectedItemChanged:)
             name: SelectedItemChangedEvent
           object: pathModelView];
  [nc addObserver: self
         selector: @selector(visibleTreeChanged:)
             name: VisibleTreeChangedEvent
           object: pathModelView];
  [nc addObserver: self
         selector: @selector(visiblePathLockingChanged:)
             name: VisiblePathLockingChangedEvent
           object: pathModelView.pathModel];

  [nc addObserver: self
         selector: @selector(colorMappingChanged:)
             name: ColorMappingChangedEvent
           object: self.treeDrawer];

  [nc addObserver: self
         selector: @selector(windowMainStatusChanged:)
             name: NSWindowDidBecomeMainNotification
           object: self.window];
  [nc addObserver: self
         selector: @selector(windowMainStatusChanged:)
             name: NSWindowDidResignMainNotification
           object: self.window];
  [nc addObserver: self
         selector: @selector(windowKeyStatusChanged:)
             name: NSWindowDidBecomeKeyNotification
           object: self.window];
  [nc addObserver: self
         selector: @selector(windowKeyStatusChanged:)
             name: NSWindowDidResignKeyNotification
           object: self.window];
          
  [self visiblePathLockingChanged: nil];
  [self refreshDisplay];
}

- (FileItemMapping *)colorMapper {
  return self.treeDrawer.colorMapper;
}


- (ItemPathModelView *)pathModelView {
  return pathModelView;
}

- (FileItem *)treeInView {
  return showEntireVolume ? pathModelView.volumeTree : pathModelView.visibleTree;
}

- (NSRect) locationInViewForItem:(FileItem *)item onPath:(NSArray *)itemPath {
  return [selectedItemLocator locationForItem: item
                                       onPath: itemPath
                               startingAtTree: self.treeInView
                           usingLayoutBuilder: layoutBuilder
                                       bounds: self.bounds];
}

- (NSImage *)imageInViewForItem:(FileItem *)item onPath:(NSArray *)itemPath {
  NSRect sourceRect = [self locationInViewForItem: item onPath: itemPath];

  // Round such that image dimensions are always non-zero (as trying to draw into a zero-sized
  // image fails).
  //
  // Note: The only way for "w" or "h" to become zero is when the coordinate is exactly an integer
  // value and the source rectangle dimension is zero. The former is unlikely and the latter never
  // occurs (as all items in the tree have a size larger than zero)
  CGFloat x = floor(sourceRect.origin.x);
  CGFloat y = floor(sourceRect.origin.y);
  CGFloat w = ceil(sourceRect.origin.x + sourceRect.size.width) - x;
  CGFloat h = ceil(sourceRect.origin.y + sourceRect.size.height) - y;

  NSImage  *targetImage = [[[NSImage alloc] initWithSize: NSMakeSize(w, h)] autorelease];

  [targetImage lockFocus];
  [treeImage drawInRect: NSMakeRect(0, 0, w, h)
               fromRect: NSMakeRect(x, y, w, h)
              operation: NSCompositingOperationCopy
               fraction: 1.0];
  [targetImage unlockFocus];

  return targetImage;
}

- (NSRect) locationInViewForItemAtEndOfPath:(NSArray *)itemPath {
  return [self locationInViewForItem: itemPath.lastObject onPath: itemPath];
}

- (NSImage *)imageInViewForItemAtEndOfPath:(NSArray *)itemPath {
  return [self imageInViewForItem: itemPath.lastObject onPath: itemPath];
}


- (TreeDrawerSettings *)treeDrawerSettings {
  DrawTaskExecutor  *drawTaskExecutor = (DrawTaskExecutor *)drawTaskManager.taskExecutor;

  return drawTaskExecutor.treeDrawerSettings;
}

- (void) setTreeDrawerSettings:(TreeDrawerSettings *)settings {
  DrawTaskExecutor  *drawTaskExecutor = (DrawTaskExecutor *)drawTaskManager.taskExecutor;
  OverlayDrawTaskExecutor  *overlayDrawTaskExecutor = (OverlayDrawTaskExecutor *
                                                       )overlayDrawTaskManager.taskExecutor;

  TreeDrawerSettings  *oldSettings = drawTaskExecutor.treeDrawerSettings;
  if (settings != oldSettings) {
    [oldSettings retain];

    [drawTaskExecutor setTreeDrawerSettings: settings];
    [overlayDrawTaskExecutor setOverlayDrawerSettings: settings];
    
    if (settings.colorPalette != oldSettings.colorPalette) {
      [self postColorPaletteChanged]; 
    }

    if (settings.drawItems != oldSettings.drawItems) {
      pathModelView.drawItems = settings.drawItems;
    }

    [oldSettings release];

    [self forceRedraw];
  }
}


- (void)setOverlayTest:(FileItemTest *)overlayTest {
  if (overlayTest != _overlayTest) {
    [_overlayTest release];
    _overlayTest = [overlayTest retain];

    [self forceOverlayRedraw];
  }
}


- (NSRect) zoomBounds {
  return zoomBounds;
}

- (void) setZoomBounds:(NSRect)bounds {
  zoomBounds = bounds;
  [self setNeedsLayout: YES];
}


- (NSRect) pathEndRect {
  return pathEndRect;
}

- (void) setPathEndRect:(NSRect)rect {
  pathEndRect = rect;
  [self refreshDisplay];
}


- (BOOL) showEntireVolume {
  return showEntireVolume;
}

- (void) setShowEntireVolume:(BOOL)flag {
  if (flag != showEntireVolume) {
    showEntireVolume = flag;
    [self forceRedraw];
  }
}

- (unsigned) displayDepth {
  return self.treeDrawerSettings.displayDepth;
}

- (void) setDisplayDepth:(unsigned)depth {
  self.treeDrawerSettings = [self.treeDrawerSettings settingsWithChangedDisplayDepth: depth];
  self.pathModelView.displayDepth = depth;
}

- (TreeLayoutBuilder *)layoutBuilder {
  return layoutBuilder;
}

- (BOOL) validateAction:(SEL)action {
  if (action == @selector(zoomIn:)) {
    return self.canZoomIn;
  }
  if (action == @selector(zoomOut:)) {
    return self.canZoomOut;
  }
  if (action == @selector(resetZoom:)) {
    return self.canResetZoom;
  }
  if (action == @selector(moveSelectionFocusUp:)) {
    return self.canMoveSelectionFocusUp;
  }
  if (action == @selector(moveSelectionFocusDown:)) {
    return self.canMoveSelectionFocusDown;
  }
  if (action == @selector(resetSelectionFocus:)) {
    return self.canResetSelectionFocus;
  }
  if (action == @selector(moveDisplayFocusUp:)) {
    return self.canMoveDisplayFocusUp;
  }
  if (action == @selector(moveDisplayFocusDown:)) {
    return self.canMoveDisplayFocusDown;
  }
  if (action == @selector(resetDisplayFocus:)) {
    return self.canResetDisplayFocus;
  }

  return NO;
}

- (BOOL) validateMenuItem:(NSMenuItem *)item {
  return [self validateAction: item.action];
}

- (BOOL) canZoomIn {
  return (pathModelView.pathModel.isVisiblePathLocked &&
          pathModelView.canMoveVisibleTreeDown);
}

- (BOOL) canZoomOut {
  return pathModelView.canMoveVisibleTreeUp;
}

- (BOOL) canResetZoom {
  return pathModelView.canMoveVisibleTreeUp;
}


- (void) zoomIn:(id)sender {
  if (self.showEntireVolume) {
    [pathModelView moveVisibleTreeDown];
  } else {
    [self animateZoomIn];
  }
}

- (void) zoomOut:(id)sender {
  if (self.showEntireVolume) {
    [pathModelView moveVisibleTreeUp];
  } else {
    [self animateZoomOut];
  }
}

- (void) resetZoom:(id)sender {
  // Simple way to reset the zoom. The animation is not as nice as it can possibly be (as each
  // step is invidually animated and all but the last animation steps are aborted). However, it is
  // not worh the hassle/complexity to improve this.
  while (self.canZoomOut) {
    [self zoomOut: sender];
  }
}


- (BOOL) canMoveSelectionFocusUp {
  return pathModelView.canMoveSelectionUp;
}

- (BOOL) canMoveSelectionFocusDown {
  return !pathModelView.selectionSticksToEndPoint;
}

- (BOOL) canResetSelectionFocus {
  return !pathModelView.selectionSticksToEndPoint;
}


- (void) moveSelectionFocusUp:(id)sender {
  [pathModelView moveSelectionUp]; 
}

- (void) moveSelectionFocusDown:(id)sender {
  if (pathModelView.canMoveSelectionDown) {
    [pathModelView moveSelectionDown];
  }
  else {
    [pathModelView setSelectionSticksToEndPoint: YES];
  }
}

- (void) resetSelectionFocus:(id)sender {
  [pathModelView setSelectionSticksToEndPoint: YES];
}


- (BOOL) canMoveDisplayFocusUp {
  return self.displayDepth > MIN_DISPLAY_DEPTH_LIMIT;
}

- (BOOL) canMoveDisplayFocusDown {
  return self.displayDepth != NO_DISPLAY_DEPTH_LIMIT;
}

- (BOOL) canResetDisplayFocus {
  return self.displayDepth != TreeDrawerSettings.defaultDisplayDepth;
}

- (void) moveDisplayFocusUp:(id)sender {
  if (!self.canMoveDisplayFocusUp) return;

  // Ensure the change is always visible
  self.displayDepth = MIN(self.maxDrawDepth, self.treeDrawerSettings.displayDepth) - 1;

  [self postDisplayFocusChanged];
}

- (void) moveDisplayFocusDown:(id)sender {
  if (!self.canMoveDisplayFocusDown) return;

  // Ensure the change is always visible
  unsigned newDepth = self.treeDrawerSettings.displayDepth + 1;
  if (newDepth > MAX_DISPLAY_DEPTH_LIMIT || newDepth >= self.maxDrawDepth) {
    newDepth = NO_DISPLAY_DEPTH_LIMIT;
  }

  self.displayDepth = newDepth;

  [self postDisplayFocusChanged];
}

- (void) resetDisplayFocus:(id)sender {
  self.displayDepth = TreeDrawerSettings.defaultDisplayDepth;

  [self postDisplayFocusChanged];
}


- (void) drawRect:(NSRect)rect {
  if (pathModelView == nil) {
    return;
  }
  
  if (treeImage != nil && !NSEqualSizes(treeImage.size, self.bounds.size)) {
    // Handle resizing of the view

    // Scale the existing image(s) for the new size. They will be used until redrawn images are
    // available.
    treeImageIsScaled = YES;
    overlayImageIsScaled = YES;

    // Abort any ongoing drawing tasks
    isTreeDrawInProgress = NO;
    isOverlayDrawInProgress = NO;

    // Recalculate the path-end rectangle to reflect the resizing
    [self updatePathEndRect: NO];
  }

  // Initiate background draw tasks if needed
  if ((treeImage == nil || treeImageIsScaled) && !isTreeDrawInProgress) {
    [self startTreeDrawTask];
  } else if ((overlayImage == nil || overlayImageIsScaled) &&
             _overlayTest != nil && !isOverlayDrawInProgress) {
    [self startOverlayDrawTask];
  }

  if (zoomImage != nil) {
    [self drawZoomAnimation];
  } else if (treeImage != nil) {
    [treeImage drawInRect: self.bounds
                 fromRect: NSZeroRect
                operation: NSCompositingOperationCopy
                 fraction: 1.0f];

    if (overlayImage != nil) {
      [overlayImage drawInRect: self.bounds
                      fromRect: NSZeroRect
                     operation: NSCompositingOperationColorDodge
                      fraction: self.animatedOverlayStrength];
    }

    if (!treeImageIsScaled) {
      if (pathModelView.isSelectedFileItemVisible) {
        [pathDrawer drawVisiblePath: pathModelView
                     startingAtTree: self.treeInView
                        withEndRect: pathEndRect
                 usingLayoutBuilder: layoutBuilder
                             bounds: self.bounds];
      }
    }
  }
}


- (BOOL) isOpaque {
  // This setting was originally set to YES for performance reasons. The views contents are rendered
  // using a view-spanning image without transparency, so the view is fully opaque. However, this
  // setting causes drawing artifacts when zooming in (#94: Black pixel artefacts during zoom-in
  // animation). These may be due to a problem in the underlying framework. Maybe this will
  // eventually be fixed, but until then, falling back to the default NO setting.
  return NO;
}

- (BOOL) acceptsFirstResponder {
  return YES;
}

- (BOOL) becomeFirstResponder {
  return YES;
}

- (BOOL) resignFirstResponder {
  return YES;
}


- (BOOL)performKeyEquivalent:(NSEvent *)theEvent {
  int  flags = theEvent.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  NSString  *chars = theEvent.characters;
  unichar const  code = [chars characterAtIndex: 0];
  
  if ([chars isEqualToString: @" "]) {
    if (flags == 0) {
      SEL  action = @selector(previewFile:);
      DirectoryViewControl*  target = (DirectoryViewControl*)
        [NSApplication.sharedApplication targetForAction: action];
      if ([target validateAction: action]) {
        [target previewFile: self];
      }
      return YES;
    }
  }
  else if (pathModelView.pathModel.isVisiblePathLocked) {
    // Navigation via arrow keys is active when the path is locked (so that mouse movement does not
    // interfere).
    BOOL handled = YES;
    switch (code) {
      case NSUpArrowFunctionKey: [self moveSelectedItem: DirectionUp]; break;
      case NSDownArrowFunctionKey: [self moveSelectedItem: DirectionDown]; break;
      case NSRightArrowFunctionKey: [self moveSelectedItem: DirectionRight]; break;
      case NSLeftArrowFunctionKey: [self moveSelectedItem: DirectionLeft]; break;
      default: handled = NO;
    }
    if (handled) {
      return YES;
    }
  }

  return NO;
}


- (void) scrollWheel: (NSEvent *)theEvent {
  scrollWheelDelta += theEvent.deltaY;
  
  if (scrollWheelDelta > 0) {
    if (! self.canMoveSelectionFocusDown) {
      // Keep it at zero, to make moving up not unnecessarily cumbersome.
      scrollWheelDelta = 0;
    }
    else if (scrollWheelDelta > SCROLL_WHEEL_SENSITIVITY + 0.5f) {
      [self moveSelectionFocusDown: nil];

      // Make it easy to move up down again.
      scrollWheelDelta = - SCROLL_WHEEL_SENSITIVITY;
    }
  }
  else {
    if (! self.canMoveSelectionFocusUp) {
      // Keep it at zero, to make moving up not unnecessarily cumbersome.
      scrollWheelDelta = 0;
    }
    else if (scrollWheelDelta < - (SCROLL_WHEEL_SENSITIVITY + 0.5f)) {
      [self moveSelectionFocusUp: nil];

      // Make it easy to move back down again.
      scrollWheelDelta = SCROLL_WHEEL_SENSITIVITY;
    }
  }
}


- (void) mouseDown:(NSEvent *)theEvent {
  ItemPathModel  *pathModel = pathModelView.pathModel;

  if (self.window.acceptsMouseMovedEvents && pathModel.lastFileItem == pathModel.visibleTree) {
    // Although the visible path is following the mouse, the visible path is empty. This can either
    // mean that the view only shows a single file item or, more likely, the view did not yet
    // receive the mouse moved events that are required to update the visible path because it was
    // not yet the first responder.
    
    // Force building (and drawing) of the visible path.
    [self mouseMoved: theEvent];
    
    if (pathModel.lastFileItem != pathModel.visibleTree) {
      // The path changed. Do not toggle the locking. This mouse click was used to make the view the
      // first responder, ensuring that the visible path is following the mouse pointer.
      return;
    }
  }

  // Toggle the path locking.

  BOOL  wasLocked = pathModel.isVisiblePathLocked;
  if (wasLocked) {
    // Unlock first, then build new path.
    [pathModel setVisiblePathLocking: NO];
  }

  NSPoint  loc = theEvent.locationInWindow;
  [self updateSelectedItem: [self convertPoint: loc fromView: nil]];

  if (!wasLocked) {
    // Now lock, after having updated path.

    if (pathModelView.isSelectedFileItemVisible) {
      // Only lock the path if it contains the selected item, i.e. if the mouse click was inside the
      // visible tree.
      [pathModel setVisiblePathLocking: YES];
    }
  }
}


- (void) mouseMoved:(NSEvent *)theEvent {
  if (pathModelView.pathModel.isVisiblePathLocked) {
    // Ignore mouseMoved events when the item path is locked.
    //
    // Note: Although this view stops accepting mouse moved events when the path becomes locked,
    // these may be generated later on anyway, requested by other components.
    return;
  }
  
  if (! (self.window.mainWindow && self.window.keyWindow)) {
    // Only handle mouseMoved events when the window is main and key. 
    return;
  }
  
  NSPoint  loc = self.window.mouseLocationOutsideOfEventStream;
  // Note: not using the location returned by [theEvent locationInWindow] as this is not fully
  // accurate.

  NSPoint  mouseLoc = [self convertPoint: loc fromView: nil];
  BOOL isInside = [self mouse: mouseLoc inRect: self.bounds];

  if (isInside) {
    [self updateSelectedItem: mouseLoc];
  }
  else {
    [pathModelView.pathModel clearVisiblePath];
  }

  // Ensure end-point changes immediately (without animation)
  [self updatePathEndRect: NO];
}


- (NSMenu *)menuForEvent:(NSEvent *)theEvent {
  NSMenu  *popUpMenu = [[[NSMenu alloc] initWithTitle: LocalizationNotNeeded(@"Contextual Menu")]
                        autorelease];
  int  itemCount = 0;

  if ([self canPerformAction: @selector(openFile:)]) {
    NSString  *title = NSLocalizedStringFromTable(@"Open", @"PopUpMenu", @"Menu item");
    [popUpMenu insertItemWithTitle: title
                            action: @selector(openFile:)
                     keyEquivalent: @""
                           atIndex: itemCount++];
  }

  if ([self canPerformAction: @selector(previewFile:)]) {
    NSString  *title = NSLocalizedStringFromTable(@"Quick Look", @"PopUpMenu", @"Menu item");
    NSMenuItem  *menuItem = [[[NSMenuItem alloc] initWithTitle: title
                                                        action: @selector(previewFile:)
                                                 keyEquivalent: @" "]
                             autorelease];
    menuItem.keyEquivalentModifierMask = 0; // No modifiers
    [popUpMenu insertItem: menuItem atIndex: itemCount++];
  }
  
  if ([self canPerformAction: @selector(revealFileInFinder:)]) {
    NSString  *title = NSLocalizedStringFromTable(@"Reveal", @"PopUpMenu", @"Menu item");
    [popUpMenu insertItemWithTitle: title
                            action: @selector(revealFileInFinder:)
                     keyEquivalent: @""
                           atIndex: itemCount++];
  }

  if ([self canPerformAction: @selector(copy:)]) {
    NSString  *title =  NSLocalizedStringFromTable(@"Copy Path", @"PopUpMenu", @"Menu item");
    [popUpMenu insertItemWithTitle: title
                            action: @selector(copy:) 
                     keyEquivalent: @"c"
                           atIndex: itemCount++];
  }
  
  if ([self canPerformAction: @selector(deleteFile:)]) {
    NSString  *title = (pathModelView.selectedFileItem.isDirectory
                        ? NSLocalizedStringFromTable(@"Delete Folder", @"PopUpMenu", @"Menu item")
                        : NSLocalizedStringFromTable(@"Delete File", @"PopUpMenu", @"Menu item"));
    [popUpMenu insertItemWithTitle: title
                            action: @selector(deleteFile:) 
                     keyEquivalent: @""
                           atIndex: itemCount++];
  }
  
  return (itemCount > 0) ? popUpMenu : nil;
}

+ (id)defaultAnimationForKey:(NSString *)key {
  if ([key isEqualToString: @"zoomBounds"] || [key isEqualToString: @"pathEndRect"]) {
    return [CABasicAnimation animation];
  }

  return [super defaultAnimationForKey: key];
}

@end // @implementation DirectoryView


@implementation DirectoryView (PrivateMethods)

/* Checks with the target that will execute the action if it should be enabled. It assumes that the
 * target has implemented validateAction:, which is the case when the target is
 * DirectoryViewControl.
 */
- (BOOL) canPerformAction:(SEL)action {
  DirectoryViewControl  *target = [NSApplication.sharedApplication targetForAction: action];
  return [target validateAction: action];
}

- (void) forceRedraw {
  [self refreshDisplay];

  // Discard the existing image
  [treeImage release];
  treeImage = nil;

  // Invalidate any ongoing draw task
  isTreeDrawInProgress = NO;

  [self forceOverlayRedraw];
}

- (void) forceOverlayRedraw {
  [self refreshDisplay];

  [overlayImage release];
  overlayImage = nil;

  isOverlayDrawInProgress = NO;
}

- (void) startTreeDrawTask {
  NSAssert(self.bounds.origin.x == 0 && self.bounds.origin.y == 0, @"Bounds not at (0, 0)");

  // Create image in background thread.
  DrawTaskInput  *drawInput =
    [[DrawTaskInput alloc] initWithVisibleTree: pathModelView.visibleTree
                                    treeInView: self.treeInView
                                 layoutBuilder: layoutBuilder
                                        bounds: self.bounds];
  [drawTaskManager asynchronouslyRunTaskWithInput: drawInput
                                         callback: self
                                         selector: @selector(itemTreeImageReady:)];

  isTreeDrawInProgress = YES;
  [drawInput release];
}

/* Callback method that signals that the drawing task has finished execution. It is also called when
 * the drawing has been aborted, in which the image will be nil.
 */
- (void) itemTreeImageReady: (id) image {
  if (image == nil) {
    // Only take action when the drawing task has completed successfully.
    //
    // Without this check, a race condition can occur. When a new drawing task aborts the execution
    // of an ongoing task, the completion of the latter and subsequent invocation of -drawRect:
    // results in the abortion of the new task (as long as it has not yet completed).

    return;
  }

  // Note: This method is called from the main thread (even though it has been triggered by the
  // drawer's background thread). So calling setNeedsDisplay directly is okay.
  [treeImage release];
  treeImage = [image retain];
  treeImageIsScaled = NO;
  isTreeDrawInProgress = NO;

  if (zoomImage != nil) {
    // Replace initial zoom image so the layout matches the new aspect ratio.
    [zoomImage release];

    if (zoomingIn) {
      zoomImage = [treeImage retain];
    } else {
      ItemPathModel  *pathModel = pathModelView.pathModel;
      zoomImage = [[self imageInViewForItem: pathModel.itemBelowVisibleTree
                                     onPath: pathModel.itemPath] retain];
      NSAssert(zoomBackgroundImage == nil, @"zoomBackgroundImage should be nil");
      zoomBackgroundImage = [treeImage retain];
    }
  }

  [self updatePathEndRect: NO];

  [self refreshDisplay];
}

- (void) startOverlayDrawTask {
  NSAssert(self.bounds.origin.x == 0 && self.bounds.origin.y == 0, @"Bounds not at (0, 0)");

  // Create image in background thread.
  OverlayDrawTaskInput  *overlayDrawInput =
      [[OverlayDrawTaskInput alloc] initWithVisibleTree: pathModelView.visibleTree
                                             treeInView: self.treeInView
                                          layoutBuilder: layoutBuilder
                                                 bounds: self.bounds
                                            overlayTest: _overlayTest];
  [overlayDrawTaskManager asynchronouslyRunTaskWithInput: overlayDrawInput
                                                callback: self
                                                selector: @selector(overlayImageReady:)];

  isOverlayDrawInProgress = YES;
  [overlayDrawInput release];
}

- (void) overlayImageReady:(id)image {
  if (image != nil) {
    [overlayImage release];
    overlayImage = [image retain];
    overlayImageIsScaled = NO;
    isOverlayDrawInProgress = NO;

    [self refreshDisplay];
  }
}

- (float) animatedOverlayStrength {
  return (self.window.mainWindow
          ? 0.7 + 0.3 * sin([NSDate date].timeIntervalSinceReferenceDate * 3.1415)
          : 0.7);
}

- (TreeDrawer *)treeDrawer {
  return ((DrawTaskExecutor *)drawTaskManager.taskExecutor).treeDrawer;
}

- (void) refreshDisplay {
  [self setNeedsDisplay: YES];
}

- (void) enablePeriodicRedraw:(BOOL) enable {
  if (enable) {
    if (redrawTimer == nil) {
      redrawTimer = [NSTimer scheduledTimerWithTimeInterval: 0.1f
                                                     target: self
                                                   selector: @selector(refreshDisplay)
                                                   userInfo: nil
                                                    repeats: YES];
      redrawTimer.tolerance = 0.04f;
    }
  } else {
    if (redrawTimer != nil) {
      [redrawTimer invalidate];
      redrawTimer = nil;
    }
  }
}

- (void) animateZoomIn {
  // Initiate zoom animation
  ItemPathModel  *pathModel = pathModelView.pathModel;

  // If an animation is ongoing, abort it so it won't interfere
  [self abortZoomAnimation];

  zoomImage = [[self imageInViewForItem: pathModel.itemBelowVisibleTree
                                 onPath: pathModel.itemPath] retain];
  zoomBackgroundImage = [treeImage retain];
  zoomBoundsStart = [self locationInViewForItem: pathModel.itemBelowVisibleTree
                                         onPath: pathModel.itemPath];
  zoomBounds = zoomBoundsStart;
  zoomBoundsEnd = self.bounds;
  zoomingIn = YES;

  [self startZoomAnimation];

  [pathModelView moveVisibleTreeDown];
}

- (void) animateZoomOut {
  // Initiate zoom animation
  ItemPathModel  *pathModel = pathModelView.pathModel;

  // If an animation is ongoing, abort it so it won't interfere
  [self abortZoomAnimation];

  zoomImage = [treeImage retain];
  // The background image is not yet known. It will be set when the zoomed out image is drawn.
  NSAssert(zoomBackgroundImage == nil, @"zoomBackgroundImage should be nil");
  zoomBoundsStart = self.bounds;
  zoomBounds = zoomBoundsStart;
  zoomingIn = NO;

  [pathModelView moveVisibleTreeUp];

  zoomBoundsEnd = [self locationInViewForItem: pathModel.itemBelowVisibleTree
                                       onPath: pathModel.itemPath];
  [self startZoomAnimation];

  // Automatically lock path as well.
  [pathModelView.pathModel setVisiblePathLocking: YES];
}

- (void) startZoomAnimation {
  CGFloat  areaStart = rectArea(zoomBoundsStart);
  CGFloat  areaEnd = rectArea(zoomBoundsEnd);
  CGFloat  areaMin = MIN(areaStart, areaEnd);
  CGFloat  areaMax = MAX(areaStart, areaEnd);

  CGFloat  fraction = areaMin / areaMax;
  CGFloat  durationMultiplier = ramp(1 - fraction,
                                     1 - ZOOM_ANIMATION_SKIP_THRESHOLD,
                                     1 - ZOOM_ANIMATION_MAXLEN_THRESHOLD);

  if (durationMultiplier > 0) {
    [treeImage release];
    treeImage = nil;

    [NSAnimationContext beginGrouping];

    [NSAnimationContext.currentContext setDuration: 0.5 * durationMultiplier];
    [self addZoomAnimationCompletionHandler];
    self.animator.zoomBounds = zoomBoundsEnd;

    [NSAnimationContext endGrouping];
  } else {
    [self releaseZoomImages];
  }
}

- (void) drawZoomAnimation {
  NSRect *zoomP = zoomingIn ? &zoomBoundsStart : &zoomBoundsEnd;
  NSRect *fullP = zoomingIn ? &zoomBoundsEnd : &zoomBoundsStart;
  CGFloat scaleX = zoomBounds.size.width / zoomP->size.width;
  CGFloat scaleY = zoomBounds.size.height / zoomP->size.height;
  if (zoomBackgroundImage != nil) {
    CGFloat x = zoomP->origin.x - zoomBounds.origin.x / scaleX;
    CGFloat y = zoomP->origin.y - zoomBounds.origin.y / scaleY;
    [zoomBackgroundImage drawInRect: *fullP
                           fromRect: NSMakeRect(x, y,
                                                fullP->size.width / scaleX,
                                                fullP->size.height / scaleY)
                          operation: NSCompositingOperationCopy
                           fraction: 0.5];
  } else {
    [NSColor.blackColor setFill];
    NSRectFill(self.bounds);
  }

  [zoomImage drawInRect: zoomBounds
               fromRect: NSZeroRect
              operation: NSCompositingOperationCopy
               fraction: 1.0];
}

- (void) releaseZoomImages {
  [zoomImage release];
  zoomImage = nil;
  [zoomBackgroundImage release];
  zoomBackgroundImage = nil;
}

- (void) abortZoomAnimation {
  if (zoomImage == nil) {
    return;
  }
  [self releaseZoomImages];

  [NSAnimationContext beginGrouping];
  [NSAnimationContext.currentContext setDuration: 0];
  self.animator.zoomBounds = NSZeroRect;
  [NSAnimationContext endGrouping];
}

- (void) addZoomAnimationCompletionHandler {
  NSInteger  myCount = ++zoomAnimationCount;

  [NSAnimationContext.currentContext setCompletionHandler: ^{
    if (zoomAnimationCount == myCount) {
      // Only clear the images when they belong to my animation. They should not be cleared when a
      // zoom request triggered a new animation thereby aborting the previous animation.
      [self releaseZoomImages];
    }
  }];
}

- (void) updatePathEndRect:(BOOL)animate {
  NSRect  newPathEndRect = [self locationInViewForItem: pathModelView.selectedFileItemInTree
                                                onPath: pathModelView.pathModel.itemPath];

  if (!NSEqualRects(newPathEndRect, pathEndRect)) {
    [NSAnimationContext beginGrouping];
    [NSAnimationContext.currentContext setDuration: animate ? 0.3 : 0];
    self.animator.pathEndRect = newPathEndRect;
    [NSAnimationContext endGrouping];
  }
}

- (void) postColorPaletteChanged {
  [NSNotificationCenter.defaultCenter postNotificationName: ColorPaletteChangedEvent
                                                    object: self];
}

- (void) postColorMappingChanged {
  [NSNotificationCenter.defaultCenter postNotificationName: ColorMappingChangedEvent
                                                    object: self];
}

- (void) postDisplayFocusChanged {
  [NSNotificationCenter.defaultCenter postNotificationName: DisplayFocusChangedEvent
                                                    object: self];
}

/* Called when selection changes in path
 */
- (void) selectedItemChanged:(NSNotification *)notification {
  [self updatePathEndRect: YES];

  [self refreshDisplay];
}

- (void) visibleTreeChanged:(NSNotification *)notification {
  NSLog(@"visibleTreeChanged");
  [self updatePathEndRect: NO];

  [self forceRedraw];
}

- (void) visiblePathLockingChanged:(NSNotification *)notification {
  // Update the item path drawer directly. Although the drawer could also listen to the
  // notification, it seems better to do it like this. It keeps the item path drawer more general,
  // and as the item path drawer is tightly integrated with this view, there is no harm in updating
  // it directly.
  [pathDrawer setHighlightPathEndPoint: pathModelView.pathModel.isVisiblePathLocked];
 
  [self updateAcceptMouseMovedEvents];
  
  [self refreshDisplay];
}

- (void) windowMainStatusChanged:(NSNotification *)notification {
  [self updateAcceptMouseMovedEvents];

  // Only when the window is the main one enable periodic redraw. This takes care of the overlay
  // animation as well as the selected item highlight animation.
  [self enablePeriodicRedraw: self.window.mainWindow];
}

- (void) windowKeyStatusChanged:(NSNotification *)notification {
  [self updateAcceptMouseMovedEvents];
}

- (void) updateAcceptMouseMovedEvents {
  BOOL  letPathFollowMouse = !pathModelView.pathModel.isVisiblePathLocked
                              && self.window.mainWindow
                              && self.window.keyWindow;

  self.window.acceptsMouseMovedEvents = letPathFollowMouse;

  if (letPathFollowMouse) {
    // Ensures that the view also receives the mouse moved events.
    [self.window makeFirstResponder: self];
  }
}


- (void) colorMappingChanged:(NSNotification *) notification {
  // Propagate event fired by internal TreeDrawer to DirectoryView's observers. Ensure that this
  // is dispatched from the main thread (instead of from the drawing task's thread)
  dispatch_async(dispatch_get_main_queue(), ^{
    [self postColorMappingChanged];

    if (((NSNumber *)notification.userInfo[@"isInternal"]).boolValue) {
      NSLog(@"DirectorView - internal color mapping change");

      // The mapping change was due to a change not known/triggered by this directory view, so
      // no redraw was triggered yet. We should therefore do so now.
      [self forceRedraw];
    }
  });
}

- (void) updateSelectedItem: (NSPoint) point {
  [pathModelView selectItemAtPoint: point 
                    startingAtTree: self.treeInView
                usingLayoutBuilder: layoutBuilder
                            bounds: self.bounds];
  // Redrawing in response to any changes will happen when the change notification is received.
}

- (void) moveSelectedItem: (DirectionEnum) direction {
  [pathModelView moveSelectedItem: direction
                  startingAtTree: self.treeInView
              usingLayoutBuilder: layoutBuilder
                          bounds: self.bounds];
}

- (int) maxDrawDepth {
  FileItem  *rootItem = self.treeInView;

  return (rootItem.isDirectory
          ? [((DirectoryItem *)rootItem) maxDepth: MAX_DISPLAY_DEPTH_LIMIT
                                  packagesAsFiles: (self.treeDrawerSettings.drawItems
                                                    == DRAW_PACKAGES)]
          : 0);
}

@end // @implementation DirectoryView (PrivateMethods)
